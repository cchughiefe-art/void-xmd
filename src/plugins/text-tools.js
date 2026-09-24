const requireText = text => { if (!text) throw new Error('Add text after the command.'); return text; };

export default [
  {
    name: 'titlecase', aliases: ['title'], category: 'EXTRA TEXT TOOLS', description: 'Capitalize words',
    run: ({ text, reply }) => reply(requireText(text).toLowerCase().replace(/\b\p{L}/gu, letter => letter.toUpperCase()))
  },
  {
    name: 'unique', category: 'EXTRA TEXT TOOLS', description: 'Remove duplicate lines',
    run: ({ text, reply }) => reply([...new Set(requireText(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean))].join('\n'))
  },
  {
    name: 'lines', category: 'EXTRA TEXT TOOLS', description: 'Count lines',
    run: ({ text, reply }) => reply(`Lines: ${requireText(text).split(/\r?\n/).length}`)
  },
  {
    name: 'wordsort', category: 'EXTRA TEXT TOOLS', description: 'Sort words alphabetically',
    run: ({ text, reply }) => reply(requireText(text).trim().split(/\s+/).sort((a,b)=>a.localeCompare(b)).join(' '))
  },
  {
    name: 'urlencode', category: 'EXTRA TEXT TOOLS', description: 'Encode URL text',
    run: ({ text, reply }) => reply(encodeURIComponent(requireText(text)))
  },
  {
    name: 'urldecode', category: 'EXTRA TEXT TOOLS', description: 'Decode URL text',
    run: ({ text, reply }) => reply(decodeURIComponent(requireText(text)))
  },
  {
    name: 'rot13', category: 'EXTRA TEXT TOOLS', description: 'ROT13 transform',
    run: ({ text, reply }) => reply(requireText(text).replace(/[a-z]/gi, char => String.fromCharCode((char<='Z'?90:122)>=(char=char.charCodeAt(0)+13)?char:char-26)))
  }
];
