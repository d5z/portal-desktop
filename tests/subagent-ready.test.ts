import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { subagentReady } from '../desktop/main/portal/subagent-ready';
import type { Settings, PortalState, SceneTask } from '../desktop/shared/types';

it('requires connected Portal, enabled configured model and executable, suppressing known failures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-ready-'));
  const settings = {portalConfigPath:path.join(directory,'portal.toml')} as Settings;
  const portal:PortalState = {phase:'connected',message:'',logs:[]};
  const config = (enabled=true,command=process.execPath) => `[subagent]\nenabled=${enabled}\ncommand=[${JSON.stringify(command)}]\n[subagent.model]\nprovider="openai"\nmodel="fixture"\napi_key="private-test-key"\n`;
  try {
    expect(await subagentReady(directory,settings,portal,[])).toBe(false);
    await writeFile(settings.portalConfigPath!,config());
    expect(await subagentReady(directory,settings,portal,[])).toBe(true);
    for(const phase of ['stopped','reconnecting','starting','error'] as const)
      expect(await subagentReady(directory,settings,{...portal,phase},[])).toBe(false);
    const failed:SceneTask={id:'bad',sceneId:'a',status:'failed',createdAt:1,endedAt:20};
    expect(await subagentReady(directory,settings,portal,[failed])).toBe(false);
    expect(await subagentReady(directory,settings,portal,[{...failed,id:'good',status:'done',endedAt:30},failed])).toBe(true);
    await writeFile(settings.portalConfigPath!,config(false));
    expect(await subagentReady(directory,settings,portal,[])).toBe(false);
    await writeFile(settings.portalConfigPath!,config(true,path.join(directory,'missing')));
    expect(await subagentReady(directory,settings,portal,[])).toBe(false);
    await writeFile(settings.portalConfigPath!,'[subagent]\nenabled=true\n');
    expect(await subagentReady(directory,settings,portal,[])).toBe(false);
    await writeFile(settings.portalConfigPath!,'broken = "private-test-key');
    expect(await subagentReady(directory,settings,portal,[])).toBe(false);
  } finally {await rm(directory,{recursive:true,force:true});}
});
