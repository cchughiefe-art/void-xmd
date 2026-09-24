export default [
  {
    name: 'percentage', aliases: ['percent'], category: 'CALCULATORS', description: 'Calculate a percentage',
    run: ({ args, reply }) => {
      const [percent, value] = args.map(Number);
      if (![percent,value].every(Number.isFinite)) throw new Error('Usage: .percentage 15 200');
      reply(`${percent}% of ${value} = ${(percent/100)*value}`);
    }
  },
  {
    name: 'average', aliases: ['avg'], category: 'CALCULATORS', description: 'Calculate an average',
    run: ({ args, reply }) => {
      const values=args.map(Number); if(!values.length||values.some(n=>!Number.isFinite(n))) throw new Error('Usage: .average 10 20 30');
      reply(`Average: ${values.reduce((a,b)=>a+b,0)/values.length}`);
    }
  },
  {
    name: 'randomnumber', aliases: ['rand'], category: 'CALCULATORS', description: 'Random number in a range',
    run: ({ args, reply }) => {
      let [min,max]=args.map(Number); if(!Number.isFinite(min)) min=1; if(!Number.isFinite(max)){max=min;min=1;} if(min>max)[min,max]=[max,min];
      reply(String(Math.floor(Math.random()*(max-min+1))+min));
    }
  },
  {
    name: 'sqrt', category: 'CALCULATORS', description: 'Square root',
    run: ({ args, reply }) => { const n=Number(args[0]); if(!Number.isFinite(n)||n<0) throw new Error('Add a non-negative number.'); reply(String(Math.sqrt(n))); }
  },
  {
    name: 'factorial', category: 'CALCULATORS', description: 'Calculate factorial',
    run: ({ args, reply }) => { const n=Number(args[0]); if(!Number.isInteger(n)||n<0||n>100) throw new Error('Use a whole number from 0 to 100.'); let result=1n; for(let i=2n;i<=BigInt(n);i++)result*=i; reply(result.toString()); }
  }
];
