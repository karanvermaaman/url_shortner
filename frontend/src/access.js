export function parseLimit(value) {
  if(value==='') return null;
  const limit=Number(value);
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000000) throw Error('Access limit must be a whole number between 1 and 1,000,000.');
  return limit;
}
export function accessStatus(link,now=Date.now()) {
  if(link.expires&&Date.parse(link.expires)<=now) return 'expired';
  if(link.maxAccesses&&(link.accesses||0)>=link.maxAccesses) return 'exhausted';
  if(link.lastAccess&&link.cooldownSeconds&&now-Date.parse(link.lastAccess)<link.cooldownSeconds*1000) return 'cooldown';
  return 'available';
}
export async function passwordDigest(password,salt) {
  const bytes=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',bytes.encode(password),'PBKDF2',false,['deriveBits']);
  const digest=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
