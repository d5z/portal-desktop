import { Icon } from '../../shared/icons/icon';
/** A sibling of the command button so previewing never selects the command. */
export function ComposerExamples({ onSelect, option }: {
  onSelect: () => void;
  option?: { id: string; selected: boolean; onHover: () => void };
}) {
  return <button className="composer-example-trigger" type="button" role={option ? 'option' : 'menuitem'} id={option?.id}
    aria-label="交互示例" aria-selected={option?.selected} tabIndex={option ? -1 : undefined}
    onMouseDown={event => event.preventDefault()} onMouseEnter={option?.onHover} onClick={onSelect}>
    示例<Icon name="arrow-up-right-16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </button>;
}
