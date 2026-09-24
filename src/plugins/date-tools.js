const dateFrom = text => { const date=new Date(text); if(Number.isNaN(date.getTime())) throw new Error('Use a valid date, for example: .daysleft 2026-12-25'); return date; };

export default [
  {
    name: 'today', category: 'DATE & TIME', description: 'Current local date',
    run: ({ reply, config }) => reply(new Intl.DateTimeFormat('en-NG',{dateStyle:'full',timeStyle:'long',timeZone:config.timezone}).format(new Date()))
  },
  {
    name: 'daysleft', category: 'DATE & TIME', description: 'Days until a date',
    run: ({ text, reply }) => { const ms=dateFrom(text)-Date.now(); reply(ms<0?'That date has passed.':`${Math.ceil(ms/86400000)} day(s) left.`); }
  },
  {
    name: 'epoch', category: 'DATE & TIME', description: 'Convert date or epoch',
    run: ({ text, reply }) => {
      if(/^\d{10,13}$/.test(text)){const n=Number(text)*(text.length===10?1000:1);return reply(new Date(n).toISOString());}
      const date=dateFrom(text); reply(`${date.getTime()}\n${Math.floor(date.getTime()/1000)}`);
    }
  }
];
