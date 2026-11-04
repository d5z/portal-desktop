import { Icon } from '../../shared/icons/icon';
/** Fixed-size placeholders keep loading calm without mounting message resources. */
export function SceneLoading({sceneName}: {sceneName: string}) {
  return <div className="chat-scene-loading" role="status" aria-label="正在加载场景对话">
    <div className="scene-loading-heading" aria-hidden="true">
      <div className="scene-loading-mark">
        <Icon name="chat-loading" fill="none" />
        <span className="scene-loading-spark" />
      </div>
      <h2>正在恢复对话</h2>
      <p title={sceneName}>{sceneName || '你的场景'}<span>·</span>稍后接着聊</p>
    </div>
    <div className="scene-loading-transcript" aria-hidden="true">
      <div className="scene-loading-turn scene-loading-sent"><div className="scene-loading-bubble"><i/><i/></div></div>
      <div className="scene-loading-turn scene-loading-reply"><span className="scene-loading-author"/><div className="scene-loading-bubble"><i/><i/><i/></div></div>
      <div className="scene-loading-turn scene-loading-sent scene-loading-last"><div className="scene-loading-bubble"><i/></div></div>
    </div>
    <div className="scene-loading-caption" aria-hidden="true"><span className="scene-loading-dots"><i/><i/><i/></span>载入对话记录</div>
  </div>;
}
