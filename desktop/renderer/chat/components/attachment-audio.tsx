import { Icon } from '../../shared/icons/icon';
import {AttachmentDownload} from './attachment-download';
import { MessageAction } from '../../shared/components/message-action-slot';
import { MessageError } from './message-error';
import {useEffect,useRef,useState} from 'react';
const time=(value:number)=>Number.isFinite(value) ? `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}` : '0:00';
export function AttachmentAudio({src,name,endpoint,id}:{src:string;name:string;endpoint:string;id:string}) {
  const audio=useRef<HTMLAudioElement>(null);
  const playbackAttempt=useRef(0);
  const [playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[duration,setDuration]=useState(0),[error,setError]=useState('');
  const [volume, setVolume] = useState(1), [speed, setSpeed] = useState('1');
  const [peaks,setPeaks]=useState<number[]>(Array(28).fill(.12));
  const [waveformRequested, setWaveformRequested] = useState(false);
  useEffect(()=>{
    if (!waveformRequested) return;
    const controller=new AbortController();let context:AudioContext | undefined;
    // Bound preview decoding so long recordings do not allocate an unbounded audio buffer.
    void (async()=>{
      const response=await fetch(src,{signal:controller.signal});
      if(!response.ok || Number(response.headers.get('content-length'))>16*1024*1024){await response.body?.cancel();return;}
      const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
      try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16*1024*1024)return;chunks.push(value);}}finally{await reader.cancel();}
      if(controller.signal.aborted)return;
      context=new AudioContext();const data=await context.decodeAudioData(await new Blob(chunks as BlobPart[]).arrayBuffer());
      if(controller.signal.aborted)return;
      const samples=data.getChannelData(0),values=Array.from({length:28},(_,index)=>{
        const from=Math.floor(index*samples.length/28),to=Math.floor((index+1)*samples.length/28);let peak=0;
        for(let i=from;i<to;i++)peak=Math.max(peak,Math.abs(samples[i]));return peak;
      });
      const max=Math.max(...values,.001);setPeaks(values.map(value=>Math.max(.12,value/max)));
    })().catch(()=>{}).finally(()=>{void context?.close().catch(()=>{});});
    return ()=>{controller.abort();void context?.close().catch(()=>{});};
  },[src,waveformRequested]);
  function play() {
    const player = audio.current!;
    if (error) {
      // Chromium keeps failed media loads for the lifetime of the renderer URL.
      const retry = new URL(src, document.baseURI);
      retry.searchParams.set('playback_attempt', String(++playbackAttempt.current));
      player.src = retry.href;
      player.load();
    }
    setError('');
    void player.play().catch(() => setError('音频暂时无法播放'));
  }
  return <div className="attachment-audio" onMouseDown={event=>{
    const target=(event.target as HTMLElement).closest<HTMLElement>('button,summary');
    if(target){event.preventDefault();target.focus({preventScroll:true});}
  }}>
    <audio ref={audio} src={src} preload="none" onLoadedMetadata={()=>setDuration(audio.current?.duration || 0)} onTimeUpdate={()=>setPosition(audio.current?.currentTime || 0)} onPlay={()=>setPlaying(true)} onPlaying={()=>setWaveformRequested(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>{setPlaying(false);setError('音频暂时无法播放');}} />
    <button type="button" aria-label={`${playing ? '暂停' : '播放'} ${name}`}
      onClick={() => playing ? audio.current?.pause() : play()}>
      <Icon name={playing ? 'chat-pause' : 'chat-play'} width="18" height="18" />
    </button>
    <div className="audio-waveform">
      <div className="audio-waveform-bars" aria-hidden="true">{peaks.map((peak,index)=><i key={index} style={{height:`${peak*100}%`,background:index/peaks.length<=position/(duration || 1) ? 'var(--chat-wave-played, #f5f5f5)' : 'var(--chat-wave-unplayed, #606060)'}}/>)}</div>
      <input type="range" aria-label={`${name} 播放进度`} min={0} max={Number.isFinite(duration) && duration>0 ? duration : 1} step={0.1} value={position} disabled={!Number.isFinite(duration) || !duration} onChange={event=>{if(audio.current){audio.current.currentTime=Number(event.target.value);setPosition(Number(event.target.value));}}}/>
    </div>
    <span>{time(position)} / {duration>0 ? time(duration) : '—'}</span>
    <AttachmentDownload endpoint={endpoint} id={id} name={name} audioControls={{
      volume, speed,
      onVolumeChange: value => { setVolume(value); if (audio.current) audio.current.volume = value; },
      onSpeedChange: value => { setSpeed(value); if (audio.current) audio.current.playbackRate = Number(value); },
    }}>下载</AttachmentDownload>
    {error && <MessageAction><MessageError reason={`${error} · ${name}`} retryLabel={`再次播放 ${name}`} retry={play} /></MessageAction>}
  </div>;
}
