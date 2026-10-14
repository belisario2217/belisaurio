const normalized = (value: unknown) => String(value ?? "").trim().toUpperCase().replace(/Ñ/g,"X").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const particles = new Set(["DE","DEL","LA","LAS","LOS","EL","Y"]);
function surname(value: string | null) {
  const words = normalized(value).split(/\s+/).filter(word => !particles.has(word));
  return words.join("").replace(/[^A-Z]/g,"") || "X";
}
export function curpBirthDate(curp: unknown): string | null {
  const value = normalized(curp);
  if (!/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(value)) return null;
  if (!["AS","BC","BS","CC","CS","CH","CL","CM","DF","DG","GT","GR","HG","JC","MC","MN","MS","NT","NL","OC","PL","QT","QR","SP","SL","SR","TC","TS","TL","VZ","YN","ZS","NE"].includes(value.slice(11,13))
    || [...value.slice(13,16)].some(c=>!"BCDFGHJKLMNPQRSTVWXYZ".includes(c))) return null;
  const alphabet = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
  const checksum = [...value.slice(0,17)].reduce((sum,c,i) => sum + alphabet.indexOf(c)*(18-i),0);
  if ((10-checksum%10)%10 !== Number(value[17])) return null;
  const year = (/\d/.test(value[16]) ? 1900 : 2000)+Number(value.slice(4,6));
  const date = `${year}-${value.slice(6,8)}-${value.slice(8,10)}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date || date>new Date().toISOString().slice(0,10)) return null;
  return date;
}
export function curpMatchesName(curp: string, first: string, last: string, second: string | null) {
  const paternal = surname(last), maternal = surname(second);
  let given = normalized(first).split(/\s+/);
  if (given.length>1 && ["MARIA","JOSE"].includes(given[0])) given = given.slice(1);
  given = given.filter(word => !particles.has(word));
  const expected = paternal[0]+([...paternal.slice(1)].find(c=>"AEIOU".includes(c))||"X")+maternal[0]+(given[0]?.[0]||"X");
  const actual = normalized(curp).slice(0,4);
  const initialsMatch=actual===expected || (actual[1]==="X" && actual[0]===expected[0] && actual.slice(2)===expected.slice(2));
  const consonant=(word:string)=>[...word.slice(1)].find(c=>"BCDFGHJKLMNPQRSTVWXYZ".includes(c))||"X";
  const expectedConsonants=consonant(paternal)+consonant(maternal)+consonant(given[0]??"X");
  return initialsMatch && normalized(curp).slice(13,16)===expectedConsonants;
}
