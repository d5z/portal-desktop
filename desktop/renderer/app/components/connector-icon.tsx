import {
  siCloudflareworkers, siFigma, siGithub, siGitlab, siGmail, siGoogleads,
  siGooglecalendar, siGoogledrive, siGoogleslides, siGoogletasks, siNotion,
  type SimpleIcon,
} from 'simple-icons';
import { Icon } from '../../shared/icons/icon';

// The catalog has no logo field. Bundle known marks locally so icons never wait on a network request.
const marks: Record<string, SimpleIcon> = {
  github: siGithub, gitlab: siGitlab, gmail: siGmail, figma: siFigma, notion: siNotion,
  cloudflareworker: siCloudflareworkers, cloudflareworkers: siCloudflareworkers,
  googleads: siGoogleads, googlecalendar: siGooglecalendar, googledrive: siGoogledrive,
  googleslides: siGoogleslides, googletasks: siGoogletasks,
};

export function ConnectorIcon({ name }: { name: string }) {
  const mark = marks[name.toLowerCase().replace(/[^a-z0-9]/g, '')];
  return <div className="connector-card-icon" aria-hidden="true">
    {mark ? <svg viewBox="0 0 24 24" style={{ color: mark === siGithub || mark === siNotion ? 'var(--text)' : `#${mark.hex}` }}><path fill="currentColor" d={mark.path} /></svg>
      : <Icon className="connector-line-icon" name={/mail|outlook/i.test(name) ? 'rail-mail' : 'plugin'} />}
  </div>;
}
