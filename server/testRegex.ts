const tests = [
  "ASK IF CODED 1 IN RQ12 What do you",
  "ASK IF CODED 3 / 4 IN D1. Which of the following",
  "ASK THOSE SELECTED 1,2 IN RQ12",
  "ask if not coded drainex in B5)? [MA]",
  "ASK THOSE CODED YES IN Q14",
  "FILTER: CODED 1 IN Q2 Please rate",
];

const oldRegex = /(ASK\s+ALL|ASK\s+THOSE\s+[^.]*|ASK\s+IF\s+[^.]*|FILTER\s*:?\s*[^.]*)/i;
const newRegex = /(ASK\s+ALL|(?:ASK\s+THOSE|ASK\s+IF|FILTER\s*:?)\s+.*?(?=\.|\?|\n|\r|\b(?:Which|What|How|Please|Why|Do|Are|Is|Record|Show|Rank|Select|Tell)\b|\]|\)|$))/i;

for (const t of tests) {
  const m1 = t.match(oldRegex);
  const m2 = t.match(newRegex);
  console.log(`Original: ${t}`);
  console.log(`  Old: ${m1 ? m1[1] : 'null'}`);
  console.log(`  New: ${m2 ? m2[1].trim() : 'null'}`);
  console.log();
}
