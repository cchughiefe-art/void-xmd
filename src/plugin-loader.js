import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './config.js';

const pluginDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugins');
const generatedDirectory = path.join(config.dataDir, 'plugins');
const registry = new Map();
const primary = [];

export async function loadPlugins() {
  registry.clear();
  primary.length = 0;
  fs.mkdirSync(pluginDirectory, { recursive: true }); fs.mkdirSync(generatedDirectory,{recursive:true});
  const files = [pluginDirectory,generatedDirectory].flatMap(directory=>fs.readdirSync(directory).filter(name=>/\.(?:js|mjs)$/.test(name)&&!name.startsWith('_')).sort().map(file=>({file,directory})));
  for (const {file,directory} of files) {
    const module = await import(`${pathToFileURL(path.join(directory, file)).href}?v=${Date.now()}`);
    const commands = Array.isArray(module.default) ? module.default : [module.default];
    for (const plugin of commands) {
      validate(plugin, file);
      plugin._generated = directory === generatedDirectory;
      const names = [plugin.name, ...(plugin.aliases || [])].map(value => value.toLowerCase());
      for (const name of names) {
        if (registry.has(name)) throw new Error(`Duplicate plugin command: ${name}`);
        registry.set(name, plugin);
      }
      primary.push(plugin);
    }
  }
  console.log(`Loaded ${primary.length} modular commands from ${files.length} plugin files.`);
}

function validate(plugin, file) {
  if (!plugin || typeof plugin !== 'object') throw new Error(`${file}: default export must be a command object or array.`);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(plugin.name || '')) throw new Error(`${file}: invalid command name.`);
  if (typeof plugin.run !== 'function') throw new Error(`${file}: ${plugin.name} needs a run(ctx) function.`);
}

export function pluginMenu() {
  const groups = {};
  for (const plugin of primary) (groups[plugin.category || 'PLUGINS'] ||= []).push(plugin.name);
  return groups;
}

export function pluginDetails() {
  return primary.map(plugin => ({
    name: plugin.name,
    aliases: [...(plugin.aliases || [])],
    category: plugin.category || 'PLUGINS',
    description: plugin.description || 'Loaded modular VOID XMD command.',
    ownerOnly: Boolean(plugin.ownerOnly),
    groupOnly: Boolean(plugin.groupOnly),
    adminOnly: Boolean(plugin.adminOnly)
  }));
}

export async function executePlugin(ctx) {
  const plugin = registry.get(ctx.command);
  if (!plugin) return false;
  if (plugin.ownerOnly && !ctx.isOwner) throw new Error('Owner only.');
  if (plugin.groupOnly && !ctx.isGroup) throw new Error('This command only works in groups.');
  if (plugin.adminOnly && !ctx.isAdmin && !ctx.isOwner) throw new Error('Group admin only.');
  const runContext=plugin._generated?{
    reply:ctx.reply,args:ctx.args,text:ctx.text,pushName:ctx.pushName,sender:ctx.sender,chat:ctx.chat,metadata:ctx.metadata,
    isOwner:ctx.isOwner,isGroup:ctx.isGroup,isAdmin:ctx.isAdmin,isBotAdmin:ctx.isBotAdmin,
    config:{name:config.name,prefix:config.prefix,mode:config.mode,timezone:config.timezone}
  }:ctx;
  if(plugin._generated){
    let timer; try { await Promise.race([plugin.run(runContext),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Generated command exceeded the 10-second limit.')),10000);})]); }
    finally { clearTimeout(timer); }
  } else await plugin.run(runContext);
  return true;
}
