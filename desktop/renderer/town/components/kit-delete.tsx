import type { TownModel } from "../models/town";
import { useModel } from "../../shared/hooks/use-model";
import { Dialog } from "../../shared/components/dialog";

export function KitDelete({ model }: { model: TownModel }) {
  const town = useModel(model), kit = town.pendingDeleteKit;
  return <Dialog open={Boolean(kit)} onClose={() => town.cancelDeleteKit()} aria-labelledby="kit-delete-title">
    {kit && <>
      <div className="dialog-heading"><h2 id="kit-delete-title">删除本机 Kit</h2><button className="close" type="button" aria-label="取消删除 Kit" onClick={() => town.cancelDeleteKit()} /></div>
      <div className="dialog-body"><p>确定删除「{kit.name}」？</p><p className="field-help">将删除本机 Kit 文件、依赖和配置，不影响云端使用历史。</p></div>
      <div className="dialog-footer"><button type="button" onClick={() => town.cancelDeleteKit()}>取消</button><button className="danger-action" type="button" onClick={() => void town.confirmDeleteKit()}>删除本机 Kit</button></div>
    </>}
  </Dialog>;
}
