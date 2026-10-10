// guards: repeated printed stories and open assignments must not arrive on the editor's desk without a comparison link.
import {it} from 'node:test';
import assert from 'node:assert/strict';
import {collectDupPairs} from './dup-check.ts';
const place={city:'Longmont',state:'Colorado',county:'Boulder'};
it('flags reworded printed and assigned stories using shared titles and entities',()=>{
 const candidates=[{headline:'Boulder Opera plans La Traviata at Dickens Opera House in November',topic:'community'}, {headline:'Leader reports assets at former Longmont AGC Biologics plant headed to auction',topic:'business'}, {headline:'Longmont voters to decide open-space charter protections Nov. 3',topic:'government'}];
 const printed=[{slug:'opera',headline:'La Traviata comes to Dickens Opera House with Boulder Opera in November',topic:'arts',published_at:new Date().toISOString()}];
 const existing=[{id:480,status:'new',headline:'AGC Biologics facilities in Longmont and Boulder sold to auction house, press reports',topic:'business',source_urls:[]},{id:490,status:'held',headline:'Longmont ballot proposal would require voter approval to sell or convey open space',topic:'government',source_urls:[]}];
 const {pairs}=collectDupPairs({candidates,existing,printed,place});
 assert.deepEqual(pairs.map(p=>[p.candidate,p.kind,p.target]),[[0,'printed','opera'],[1,'lead',existing[0].headline],[2,'lead',existing[1].headline]]);
});
