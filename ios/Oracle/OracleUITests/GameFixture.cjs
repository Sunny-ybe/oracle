// Isolated UI-test fixture. No database, provider keys, or production writes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const image = fs.readFileSync(path.join(__dirname, '../Oracle/Assets.xcassets/OracleMark.imageset/OracleMark.png'));
const server = http.createServer((req,res) => {
 const url = new URL(req.url,'http://localhost:3189');
 res.setHeader('content-type','application/json');
 if(url.pathname==='/api/app/config') return res.end(JSON.stringify({name:'Oracle',api:1}));
 if(url.pathname==='/api/app/places/nearby') return res.end('[]');
 if(url.pathname.startsWith('/api/photos/')) {res.setHeader('content-type','image/png');return res.end(image);}
 if(url.pathname==='/api/game/rounds') {
  const rounds=Array.from({length:8},(_,i)=>({id:`fixture-${i}`,place:`Fixture Hall ${i+1}`,placeId:`fixture-place-${i}`,lat:37.79,lng:-122.39,kind:'events',question:'How crowded was this test room?',options:['Empty','Some space','Packed'],answer:2,votes:3,source:'people',at:'2026-11-14T20:01:00Z',photoUrl:`/api/photos/fixture-${i}`,photoId:`fixture-photo-${i}`,photoAt:'2026-11-14T20:00:00Z',evidence:'UI-test fixture evidence.'}));
  return res.end(JSON.stringify({minimumPhotos:8,availablePhotos:8,radiusM:3000,rounds}));
 }
 res.statusCode=404;res.end('{}');
});server.listen(3189,'127.0.0.1',()=>console.log('Isolated game fixture listening on 3189'));
