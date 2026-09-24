import { createFeatureDraft } from '../feature-builder.js';

export default {
  name:'feature',aliases:['addfeature','buildcommand'],category:'OWNER',description:'Create a reviewed command draft',ownerOnly:true,
  async run({text,reply}){
    await reply('🧠 Building a safe command draft…');
    const draft=await createFeatureDraft(text);
    await reply(`Draft created: ${draft.id}\nOpen the protected /pair dashboard to review its code and approve it.`);
  }
};
