// guards: a UTC clock must not raise a missing-scan alarm before the paper's Mountain deadline.
import assert from 'node:assert/strict';import {test} from 'node:test';import {execFileSync} from 'node:child_process';
test('daily scan alerts compare the paper local clock and day at midnight and daylight saving boundaries',()=>{
 const script=`. ./ops/lib-alert.ps1
 $results = foreach ($day in @('2026-10-09','2026-11-01','2026-03-08')) {
  $state=@{Ok=$true;Scheduled=$true;LocalDay=$day;LocalClock='02:30';LocalTime='06:00';LastDay=([datetime]$day).AddDays(-1).ToString('yyyy-MM-dd');LastStatus='finished'}
  $early=Test-TownReporterScanAlert -State $state -Now ([datetime]"$day 08:30")
  $state.LocalClock='08:30'
  $late=Test-TownReporterScanAlert -State $state -Now ([datetime]"$day 14:30")
  @{early=$early.Due;late=$late.Active}
 }; ConvertTo-Json -Compress -InputObject @($results)`;
 const rows=JSON.parse(execFileSync('pwsh',['-NoProfile','-Command',script],{encoding:'utf8'}));assert.equal(rows.length,3);for(const row of rows)assert.deepEqual(row,{early:false,late:true});
});
