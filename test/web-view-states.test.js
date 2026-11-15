import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.html',import.meta.url),'utf8');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function render(name,end,ME,REQS=[]) {
  const nodes={};
  const context={ME,REQS,esc,SENSOR_LABEL:{},watchRedemptions:()=>{},redeemDraft:null,redemptionRow:()=>'',$:(id)=>nodes[id]??=( {innerHTML:''} )};
  vm.runInNewContext(source.slice(source.indexOf(`function ${name}()`),source.indexOf(end,source.indexOf(`function ${name}()`)))+`\n${name}();`,context);
  return nodes;
}
test('rewards handle guest, low balance, missing wallet and escaped reward names',()=>{
  assert.match(render('renderRewards','\nfunction redeem(',null).rewardsBody.innerHTML,/Sign in to see rewards/);
  const ME={credits:3,rewards:[{id:'coffee',name:'Coffee <card>',points:50}],minCashout:10,pointsPerSol:1000};
  const html=render('renderRewards','\nfunction redeem(',ME).rewardsBody.innerHTML;
  assert.match(html,/47 more to go/); assert.match(html,/Coffee &lt;card&gt;/); assert.match(html,/No wallet linked/);
  assert.match(html,/disabled onclick="cashout/); assert.match(html,/disabled onclick="redeem/);
});
test('requests distinguish guests, checked-in empty state and assigned questions',()=>{
  assert.match(render('renderRequests','\nlet draft = {};',null).reqList.innerHTML,/Sign in to answer/);
  assert.match(render('renderRequests','\nlet draft = {};',{place:'Coffee'}).reqList.innerHTML,/Nothing to answer just yet/);
  const html=render('renderRequests','\nlet draft = {};',{place:'Coffee'},[{id:'q1',question:'Busy <now>?',place:'Coffee',sensor:'poll',answered:0,pinged:2}]).reqList.innerHTML;
  assert.match(html,/Busy &lt;now&gt;/); assert.match(html,/1 request ready/);
});
