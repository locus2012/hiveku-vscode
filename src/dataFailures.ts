/**
 * What a department data download says when every department failed, and
 * whether it offers to reconnect (HK-847). Three places say it: extension.ts
 * downloadData (Download Department Data) and downloadEverything (Download
 * Everything, the post-connect "Set up which account?" flow), and dataRefresh.ts
 * (the stale-data warning of auto-refresh). Pure, so
 * test/edge-refusal-readers.test.mjs pins every answer.
 *
 * The rule is the data runner's closing line (dataRunner.ts): the key is the
 * cause only when Hiveku itself refused it, with its own JSON 401, on at least
 * one dataset. A request the web edge in front of Hiveku refused never reached
 * Hiveku, and an answer that could not be read does not say who refused it, so
 * neither is a reason to reconnect. Failures that are none of these (time-outs,
 * server errors) keep the reading they always had: an expired or revoked key is
 * the usual cause.
 */

import { DATA_DIR } from './dataExport';
import { coreEdgeRefusalKind, isCoreEdgeRefusal, isHivekuKeyRefusal } from './mcpClient';

/** A dataset that came back with an error (dataExport.ts failedDatasets). */
export interface FailedDataset {
  department: string;
  dataset: string;
  error: string;
}

export interface AllFailedReading {
  /**
   * `key`: Hiveku refused the key on at least one dataset. `edge`: it never did,
   * and the web edge refused at least one, or an answer could not be read.
   * `other`: neither.
   */
  cause: 'key' | 'edge' | 'other';
  /** The dataset to show the person: the first one of the kind that decided. */
  shown: FailedDataset | undefined;
  /** Failed datasets the web edge refused, and ones whose answer could not be read. */
  edgeRefused: number;
  unreadable: number;
}

/** Read why every department failed from the failed datasets' errors. */
export function readAllFailed(failed: readonly FailedDataset[]): AllFailedReading {
  const edge = failed.filter((f) => coreEdgeRefusalKind(f.error) === 'edge_blocked');
  const unread = failed.filter((f) => coreEdgeRefusalKind(f.error) === 'unreadable');
  const counts = { edgeRefused: edge.length, unreadable: unread.length };
  const keyRefused = failed.find((f) => isHivekuKeyRefusal(f.error));
  if (keyRefused) return { cause: 'key', shown: keyRefused, ...counts };
  if (edge.length || unread.length) return { cause: 'edge', shown: edge[0] ?? unread[0], ...counts };
  return { cause: 'other', shown: failed[0], ...counts };
}

const datasets = (n: number): string => (n === 1 ? '1 dataset' : `${n} datasets`);

/**
 * Why a download where every department failed says nothing about the key, by
 * count, so it claims no more than it saw: the requests the web edge refused,
 * the answers that could not be read, and that there is no need to reconnect.
 */
export function notTheKeyWords(reading: Pick<AllFailedReading, 'edgeRefused' | 'unreadable'>): string {
  const words: string[] = [];
  if (reading.edgeRefused) {
    words.push(`The web edge in front of Hiveku refused the requests for ${datasets(reading.edgeRefused)}, so they never reached Hiveku.`);
  }
  if (reading.unreadable) {
    const one = reading.unreadable === 1;
    words.push(
      `For ${datasets(reading.unreadable)} the ${one ? 'answer' : 'answers'} could not be read, so it is not known whether ` +
        `Hiveku or the web edge in front of Hiveku refused ${one ? 'it' : 'them'}.`,
    );
  }
  words.push('None of this is a sign that the account key stopped working, so there is no need to reconnect.');
  return words.join(' ');
}

/** An error on one line, cut to fit a notification. */
export function clipError(msg: string): string {
  const oneLine = msg.replace(/\s+/g, ' ').trim();
  return oneLine.length > 180 ? `${oneLine.slice(0, 180)}…` : oneLine;
}

/**
 * Download Department Data's warning when no department returned data: the
 * words, and the buttons it offers. Reconnect only when the key may be the cause.
 */
export function allFailedWarning(o: {
  label: string;
  datasetTotal: number;
  failed: readonly FailedDataset[];
}): { message: string; actions: string[] } {
  const reading = readAllFailed(o.failed);
  const lead =
    `Nothing was downloaded for ${o.label}: no department returned data (${o.failed.length} of ${o.datasetTotal} ` +
    `datasets failed), so ${DATA_DIR}/ has no new data.`;
  const first = reading.shown ? ` First error: ${reading.shown.department}/${reading.shown.dataset}: ${clipError(reading.shown.error)}` : '';
  if (reading.cause === 'edge') {
    return { message: `${lead} ${notTheKeyWords(reading)} Run this again later.${first}`, actions: ['Open index'] };
  }
  return {
    message: `${lead} The usual cause is an expired or revoked account key: reconnect and run this again.${first}`,
    actions: ['Reconnect account', 'Open index'],
  };
}

/**
 * Download Everything's sentence about the department data, appended to its
 * summary ('' when every dataset came back). It has no buttons of its own, so
 * a key problem names the command to run.
 */
export function everythingDataNote(o: {
  deptError?: string;
  deptCount: number;
  failed: readonly FailedDataset[];
  allFailed: boolean;
}): string {
  if (o.deptError) return ` Department data was NOT downloaded: ${o.deptError}`;
  if (o.allFailed) {
    const reading = readAllFailed(o.failed);
    const lead = ` No department returned data: all ${o.deptCount} of them failed (${datasets(o.failed.length)})`;
    if (reading.cause === 'edge') {
      return (
        `${lead}. ${notTheKeyWords(reading)} Run this again later. Each failed dataset's error, with what to tell ` +
        `Hiveku support if it keeps happening, is in ${DATA_DIR}/STATUS.json under "failed".`
      );
    }
    return (
      `${lead}, which usually means this account's key is expired or revoked. Reconnect with the command ` +
      '"Hiveku: Connect Hiveku (sign in via browser)", then run this again.'
    );
  }
  if (o.failed.length) {
    return ` ${o.failed.length} dataset(s) failed and were not saved: they are listed in ${DATA_DIR}/STATUS.json under "failed".`;
  }
  return '';
}

/**
 * The buttons on auto-refresh's stale-data warning. `lastError` names the
 * dataset readAllFailed showed (dataRefresh.ts), so Hiveku's own 401 anywhere in
 * the run keeps Reconnect, and a refusal from the web edge alone drops it.
 */
export function refreshWarningActions(lastError: string): string[] {
  return isCoreEdgeRefusal(lastError)
    ? ['Retry now', 'Turn off auto-refresh']
    : ['Reconnect account', 'Retry now', 'Turn off auto-refresh'];
}
