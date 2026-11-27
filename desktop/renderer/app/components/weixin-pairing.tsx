import { createPortal } from 'react-dom';
import { Dialog } from '../../shared/components/dialog';
import { Icon } from '../../shared/icons/icon';
import { useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { HomeConnectorEnableState, HomeConnectorPreview } from '../../../shared/home';
import type { ConnectorContext, ConnectorResources, WeixinQR } from '../../../shared/connector-resources';
import { publicErrorMessage } from '../../../shared/errors';

const labels: Record<WeixinQR['state'], string> = {
  waiting: '请用手机微信扫描二维码', scanned: '已扫码，请在手机上确认', needs_verification: '请输入手机显示的配对码',
  connecting: '正在准备连接与工具…', ready: '扫码已确认，正在核对工具状态…',
  expired: '二维码已过期，请重新连接', cancelled: '连接已取消', failed: '连接失败，请重新扫码',
};
export function WeixinPairing({ resources, releaseId, initialPreview, onReady, onClose }: {
  resources: ConnectorResources; releaseId: string; initialPreview?: HomeConnectorPreview;
  onReady: (enable: HomeConnectorEnableState, context: ConnectorContext) => Promise<void>; onClose: () => void;
}) {
  const [preview, setPreview] = useState<HomeConnectorPreview>();
  const [qr, setQR] = useState<WeixinQR>();
  const [image, setImage] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true), committed = useRef(false), locked = useRef(false), cancelledIntent = useRef(false);
  const started = useRef(false);
  const intent = useRef<string | undefined>(undefined);
  const binding = useRef<ConnectorContext | undefined>(undefined);
  const controller = useRef(new AbortController());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestPath = () => `/v1/me/kit-connector-enables/${encodeURIComponent(intent.current!)}/weixin-qr`;
  const cancel = () => {
    controller.current.abort(); clearTimeout(timer.current); setCode('');
    if (!committed.current && !cancelledIntent.current && intent.current && binding.current) {
      cancelledIntent.current = true;
      void resources.request(binding.current, started.current ? requestPath() : `/v1/me/kit-connector-enables/${encodeURIComponent(intent.current)}/cancel`, started.current ? 'DELETE' : 'POST').catch(() => {});
    }
  };
  useEffect(() => {
    let cancelled = false;
    alive.current = true; controller.current = new AbortController();
    void (async () => {
      const next = await resources.context();
      if (cancelled) return;
      binding.current = next;
      const value = initialPreview && Date.parse(initialPreview.expires_at) > Date.now() ? initialPreview : await resources.request<HomeConnectorPreview>(next, `/v1/me/kit-releases/${encodeURIComponent(releaseId)}/connector-preview`, 'POST', { method: 'custom_credential' });
      if (cancelled) {
        void resources.request(next, `/v1/me/kit-connector-enables/${encodeURIComponent(value.id)}/cancel`, 'POST').catch(() => {});
        return;
      }
      intent.current = value.id; cancelledIntent.current = false;
      setPreview(value);
      if (!value.requires_adoption) await submit(false, value);
    })().catch(e => { if (!cancelled) setError(publicErrorMessage(e, '无法准备微信连接。')); });
    const hide = () => { if (document.hidden) { cancel(); onClose(); } };
    document.addEventListener('visibilitychange', hide);
    return () => { cancelled = true; alive.current = false; cancel(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  const consume = async (value: WeixinQR, creating = false) => {
    if (!alive.current || controller.current.signal.aborted) return;
    clearTimeout(timer.current);
    const enable = value.enable;
    if (enable && (enable.id !== intent.current || enable.release_id !== releaseId))
      throw new Error('连接结果与当前应用不匹配，请重新连接。');
    const awaitingScan = value.state === 'waiting' || value.state === 'scanned';
    if (creating && awaitingScan && !value.qr_content) throw new Error('Home 返回的扫码会话缺少二维码内容。');
    if (value.qr_content && awaitingScan) {
      try {
        const matrix = qrcode(0, 'M');
        matrix.addData(value.qr_content, 'Byte');
        matrix.make();
        setImage(matrix.createDataURL(5, 20));
      } catch {
        throw new Error('已收到二维码内容，但客户端无法编码。');
      }
    } else if (value.state !== 'waiting' && value.state !== 'scanned') setImage('');
    setQR(value);
    setError('');
    if (enable?.status === 'ready') {
      if (!enable.connection_id || !enable.installation_id) throw new Error('连接已就绪，但服务端未返回账号或安装 ID。');
      committed.current = true; clearTimeout(timer.current); setImage(''); setCode('');
      await onReady(enable, binding.current!); return;
    }
    if (enable && ['failed', 'expired', 'cancelled', 'needs_auth'].includes(enable.status)) { setQR({ ...value, state: 'failed' }); setImage(''); return; }
    if (['expired', 'cancelled', 'failed'].includes(value.state)) { setImage(''); return; }
    if (!['connecting', 'ready'].includes(value.state) && Date.parse(value.expires_at) <= Date.now()) { setQR({ ...value, state: 'expired' }); setImage(''); return; }
    if (value.state === 'needs_verification') {
      timer.current = setTimeout(() => { setCode(''); setQR({ ...value, state: 'expired' }); setImage(''); }, Math.max(0, Date.parse(value.expires_at) - Date.now()));
    } else {
      timer.current = setTimeout(() => void advance(value), 1500);
    }
  };
  const advance = async (previous: WeixinQR) => {
    if (!alive.current || locked.current) return;
    locked.current = true;
    try {
      const current = await resources.context();
      if (current.session !== binding.current?.session || current.endpoint !== binding.current?.endpoint) { cancel(); onClose(); return; }
      const next = previous.enable && (previous.state === 'connecting' || previous.state === 'ready')
        ? { ...previous, enable: await resources.request<HomeConnectorEnableState>(binding.current!, `/v1/me/kit-connector-enables/${encodeURIComponent(intent.current!)}/advance`, 'POST', undefined, controller.current.signal) }
        : await resources.request<WeixinQR>(binding.current!, requestPath() + '/advance', 'POST', undefined, controller.current.signal);
      await consume(next);
    } catch (e) { if (alive.current && !controller.current.signal.aborted) setError(publicErrorMessage(e, '扫码状态暂时无法更新，请重试。')); }
    finally { locked.current = false; }
  };
  const resume = async () => {
    if (!binding.current || locked.current) return;
    if (qr && !committed.current && qr.state !== 'needs_verification') {
      setError('');
      await advance(qr);
      return;
    }
    locked.current = true; setError(''); clearTimeout(timer.current);
    try { await consume(await resources.request<WeixinQR>(binding.current, requestPath(), 'GET', undefined, controller.current.signal)); }
    catch (e) { if (alive.current && !controller.current.signal.aborted) setError(publicErrorMessage(e, '扫码会话无法恢复，请重新连接。')); }
    finally { locked.current = false; }
  };
  const submit = async (verify: boolean, currentPreview = preview) => {
    const context = binding.current;
    if (locked.current || !context || !currentPreview || (verify && qr?.state !== 'needs_verification')) return;
    locked.current = true; setBusy(true); setError(''); clearTimeout(timer.current);
    const submittedCode = code; setCode('');
    const recovering = !verify && started.current;
    try {
      if (!verify && Date.parse(currentPreview.expires_at) <= Date.now()) throw new Error('权限预览已过期，请关闭后重新连接。');
      started.current = true;
      await consume(await resources.request<WeixinQR>(context, requestPath() + (verify ? '/verify' : ''), recovering ? 'GET' : 'POST',
        recovering ? undefined : verify ? { code: submittedCode } : { adopt: currentPreview.requires_adoption }, controller.current.signal), !verify && !recovering);
    } catch (e) {
      if (alive.current && !controller.current.signal.aborted) {
        const status = e instanceof Error && 'status' in e ? e.status : undefined;
        const step = verify ? '验证微信配对码失败' : recovering ? '读取微信扫码状态失败' : '获取微信二维码失败';
        setError(`${step} · ${publicErrorMessage(e, '请重试。')}`);
        if (!verify && !recovering && [400, 401, 403, 404, 405, 422].includes(Number(status))) {
          started.current = false;
        } else if (!verify && !recovering && typeof status === 'number' && status >= 500) {
          try { await consume(await resources.request<WeixinQR>(context, requestPath(), 'GET', undefined, controller.current.signal)); }
          catch { /* Keep the explicit error; never repeat a possibly accepted start automatically. */ }
        }
      }
    }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  const close = () => { cancel(); onClose(); };
  const requiresConfirmation = preview?.requires_adoption && !started.current && !qr;
  return createPortal(<Dialog open className="connector-weixin-dialog" aria-labelledby="connector-weixin-title" onClose={close} dismissOnBackdrop>
    <div className="dialog-heading">
      <h2 id="connector-weixin-title">扫码连接微信</h2>
      <button className="icon-button" type="button" aria-label="关闭扫码弹窗" onClick={close}><Icon name="chat-close" /></button>
    </div>
    <div className="dialog-body connector-weixin-body">
      {!qr && !error && !requiresConfirmation && <p role="status">正在获取二维码…</p>}
      {requiresConfirmation && <p>接管后，此账号的旧工具入口会停用。</p>}
      {qr && <p role="status">{labels[qr.state]}</p>}
      {preview && <p>当前环境支持自动收发时，连接后会自动接收微信消息并回复，可在应用详情随时停止。</p>}
      {image && <img className="connector-weixin-qr" src={image} alt="微信 Bot 配对二维码" />}
      {preview && <details className="connector-weixin-permissions" open={requiresConfirmation || undefined}>
        <summary>权限与工具范围</summary>
        <p>初始只读工具：{preview.read_actions.join('、') || '无'}</p>
        <p>自动收发开启时，Home 会启用取消息和文字回复。</p>
        <p>其他需单独开启的写工具：{preview.write_actions.filter(action => action !== 'weixin_bot.send_message').join('、') || '无'}</p>
        <p>第三方授权范围：{preview.scopes.join('、') || '无额外声明'}</p>
        {preview.permission_notes.map(note => <p key={note}>{note}</p>)}
      </details>}
      {qr?.state === 'needs_verification' && <form onSubmit={e => { e.preventDefault(); void submit(true); }}>
        <label className="connector-field">手机配对码<input type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} disabled={busy} /></label>
        <div className="connector-action-row"><button className="primary" disabled={busy || !code.trim()} type="submit">确认配对码</button></div>
      </form>}
      {qr?.error_code && <p role="alert">{qr.error_code}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <div className="dialog-footer connector-action-row">
      <button type="button" onClick={close}>{committed.current ? '关闭' : '取消连接'}</button>
      {requiresConfirmation && <button className="primary" type="button" disabled={busy} onClick={() => void submit(false)}>同意接管并扫码</button>}
      {error && preview && !requiresConfirmation && !started.current && <button className="primary" type="button" disabled={busy} onClick={() => void submit(false)}>重试获取二维码</button>}
      {error && started.current && intent.current && (!qr || !['expired', 'cancelled', 'failed'].includes(qr.state) || committed.current) && <button type="button" disabled={busy} onClick={() => void resume()}>重试更新状态</button>}
    </div>
  </Dialog>, document.body);
}
