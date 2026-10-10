export function validateUrl(input){
 if(typeof input!=='string'||input.length>4096)throw Error('Enter a URL under 4,096 characters.');
 let url;try{url=new URL(input.trim())}catch{throw Error('Enter a complete URL starting with https:// or http://.');}
 if(!['https:','http:'].includes(url.protocol))throw Error('Only HTTP and HTTPS URLs are allowed.');
 if(url.username||url.password)throw Error('URLs with embedded login credentials are not allowed.');
 if(!url.hostname.includes('.')||url.hostname==='localhost'||url.hostname.endsWith('.local'))throw Error('Enter a public website address.');
 return url.href;
}
