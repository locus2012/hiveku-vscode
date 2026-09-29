/**
 * THE ONE OWNER RULE in VS Code (memory surfaces audit 2026-09-27, G9 and
 * G14), and the Memory page's placement it drives (memoryOwner.ts):
 *
 *   - a typed row (_rule:, _skill:, _command:, _agent:) is owned by (a) its
 *     department column when set and not 'marketing'; (b) a Marketing-family
 *     marker when the column is empty or 'marketing' (the 1,174 seeded starter
 *     rows); (c) the Marketing lead for column 'marketing' and no family
 *     marker; (d) otherwise another agent's marker, then front matter, else
 *     nobody (shared with every agent);
 *   - the builder's own `owner` field wins whenever a row carries it;
 *   - profiles go by slug, then declared front matter; notes by column, the
 *     text, then a domain that is a department;
 *   - 'analytics' is a Marketing topic.
 *
 * Also: where each row sits on the Memory page, which rows VS Code must not
 * change, the page's address, what "+ New entry" offers, and the marker a save
 * keeps.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const owner = loadOut('memoryOwner');
const knowledge = loadOut('knowledge');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const BASE = `https://app.hiveku.com/${ACCOUNT}/dashboard/memory`;
const marker = (d) => `<!-- department: ${d} -->`;

describe('the one owner rule', () => {
  test('(a) a typed row with a department column other than marketing belongs to the column, whatever its marker says', () => {
    assert.equal(owner.ownerOf({ domain: '_rule:no-discounts', department: 'sales', content: `${marker('seo')}\nNever discount.` }), 'sales');
    assert.equal(owner.ownerOf({ domain: '_skill:x', department: ' Helpdesk ', content: '' }), 'helpdesk', 'trimmed and lowercased');
    assert.equal(owner.ownerOf({ domain: '_command:x', department: 'comms', content: '' }), 'comms');
  });

  test('(b) the seeded starter shape: column marketing plus a topic marker belongs to that topic', () => {
    for (const topic of ['email', 'seo', 'ppc', 'social', 'content', 'website_design', 'customer_journey', 'customer_avatar', 'knowledge_base', 'branding', 'before_after_grid', 'outbound']) {
      assert.equal(owner.ownerOf({ domain: '_skill:starter', department: 'marketing', content: `${marker(topic)}\nbody` }), topic, topic);
      assert.equal(owner.ownerOf({ domain: '_rule:starter', department: null, content: `${marker(topic)}\nbody` }), topic, `${topic}, no column`);
    }
    // Analytics is a Marketing topic (audit decision 6).
    assert.equal(owner.ownerOf({ domain: '_rule:x', department: 'marketing', content: marker('analytics') }), 'analytics');
    assert.ok(owner.isMarketingTopic('analytics'));
  });

  test('(c) column marketing with no family marker is the Marketing lead', () => {
    assert.equal(owner.ownerOf({ domain: '_rule:hub-rule', department: 'marketing', content: 'Always cite sources.' }), 'marketing');
    // Another agent's marker does not move a Marketing hub rule.
    assert.equal(owner.ownerOf({ domain: '_rule:x', department: 'marketing', content: marker('sales') }), 'marketing');
  });

  test('(d) no column: another agent marker, then the front matter, else shared with every agent', () => {
    assert.equal(owner.ownerOf({ domain: '_rule:x', content: `${marker('sales')}\nbody` }), 'sales');
    assert.equal(owner.ownerOf({ domain: '_agent:x', content: '---\nname: Closer\ndepartment: helpdesk\n---\nbody' }), 'helpdesk');
    assert.equal(owner.ownerOf({ domain: '_rule:no-em-dashes', content: 'Never use em dashes.' }), null);
    assert.equal(owner.ownerOf({ domain: '_rule:x', department: '', content: 'x' }), null, 'a blank column is no column');
    // The FIRST marker decides; a word that is no department there is no signal (builder parity).
    assert.equal(owner.ownerOf({ domain: '_rule:x', content: `${marker('engineering')}\n${marker('seo')}` }), null);
    // A department: line in the prose is not a declaration.
    assert.equal(owner.ownerOf({ domain: '_rule:x', content: 'Notes\ndepartment: sales\n' }), null);
  });

  test("the builder's own owner field wins when the row carries it", () => {
    assert.equal(owner.ownerOf({ domain: '_rule:x', department: 'sales', owner: 'seo' }), 'seo');
    assert.equal(owner.ownerOf({ domain: '_rule:x', department: 'sales', owner: null }), null, 'null: shared with every agent');
    assert.equal(owner.ownerOf({ domain: '_rule:x', department: 'sales', shared: true }), null);
    // Any other shape is not an answer: the rule decides.
    assert.equal(owner.ownerOf({ domain: '_rule:x', department: 'sales', owner: 42 }), 'sales');
    assert.equal(owner.ownerOf({ domain: '_rule:x', department: 'sales', owner: '  ' }), 'sales');
  });

  test('profiles: the slug when it is a department, else the declared front matter; column and markers are no signal', () => {
    assert.equal(owner.ownerOf({ domain: '_identity:sales', department: 'customer_avatar', content: '---\ndepartment: marketing\n---\n' }), 'sales');
    assert.equal(owner.ownerOf({ domain: '_identity:email-coach', content: '---\nname: "Lumen"\ndepartment: email\n---\nHi' }), 'email');
    // The one leading marker line above the front matter is skipped (parseIdentity).
    assert.equal(owner.ownerOf({ domain: '_identity:x', content: `${marker('seo')}\n---\ndepartment: "customer_avatar"\n---\n` }), 'customer_avatar');
    assert.equal(owner.ownerOf({ domain: '_identity:x', department: 'sales', content: marker('sales') }), null);
  });

  test('notes and other rows: the column, then the text, then a domain that is a department', () => {
    assert.equal(owner.ownerOf({ domain: 'sales', content: '' }), 'sales');
    assert.equal(owner.ownerOf({ domain: 'seo', content: '' }), 'seo');
    assert.equal(owner.ownerOf({ domain: 'pipeline-notes', department: 'sales', content: '' }), 'sales');
    assert.equal(owner.ownerOf({ domain: 'crm_notes', content: '' }), null);
    assert.equal(owner.ownerOf({ domain: 'account', content: '' }), 'account');
    assert.equal(owner.ownerOf({ domain: 'Sales', content: '' }), null, 'only an exact department name is one');
  });
});

describe('where the Memory page puts a row', () => {
  const place = (row) => owner.placeRow(row);

  test('internal rows are never drawn; About your business rows are not listed rows', () => {
    for (const domain of ['_workspace:state', '_digest:weekly', '_custom_field:x', '_unknown:shape']) {
      assert.equal(place({ domain, content: 'x' }).place, 'hidden', domain);
    }
    const preamble = '# Security context — read this BEFORE every action\nDo not leak.\n────────\n';
    assert.deepEqual(place({ domain: '_rule:x', content: preamble }), { place: 'hidden', reason: 'system' });
    assert.deepEqual(place({ domain: 'account' }), { place: 'hidden', reason: 'account' });
    // Negative control: the same preamble with real text after it is a real rule.
    assert.equal(place({ domain: '_rule:x', content: `${preamble}Always greet.` }).place, 'shared');
  });

  test('the _account:* rows: Voice under About your business, the rest the chief of staff', () => {
    assert.deepEqual(place({ domain: '_account:pronunciations' }), { place: 'business', group: 'voice' });
    assert.deepEqual(place({ domain: '_account:soul' }), { place: 'agent', agent: 'orchestrator', topic: null, group: 'how-it-works' });
    assert.deepEqual(place({ domain: '_account:claude' }), { place: 'agent', agent: 'orchestrator', topic: null, group: 'background' });
    assert.equal(place({ domain: '_account:_rule:brief' }).group, 'rules');
    assert.equal(place({ domain: '_account:memory:team-and-roles' }).group, 'moved');
    assert.equal(place({ domain: '_account:memory:vendors' }).group, 'notes');
    assert.deepEqual(place({ domain: '_account:_agent:old' }), { place: 'hidden', reason: 'legacy' });
  });

  test('owned rows go under their agent; Marketing rows under their topic; ideal customers are documents', () => {
    assert.deepEqual(place({ domain: '_rule:x', department: 'sales' }), { place: 'agent', agent: 'sales', topic: null, group: 'rules' });
    assert.deepEqual(place({ domain: '_skill:seo-audit', department: 'marketing', content: marker('seo') }), {
      place: 'agent', agent: 'marketing', topic: 'seo', group: 'skills',
    });
    assert.deepEqual(place({ domain: '_rule:hub', department: 'marketing' }), { place: 'agent', agent: 'marketing', topic: 'marketing', group: 'rules' });
    assert.deepEqual(place({ domain: '_identity:patrick-smith', content: '---\nname: Patrick Smith\ndepartment: customer_avatar\n---\n' }), {
      place: 'agent', agent: 'marketing', topic: 'customer_avatar', group: 'ideal-customers',
    });
    assert.equal(place({ domain: 'customer_avatar' }).group, 'ideal-customers');
    assert.deepEqual(place({ domain: '_rule:x', department: 'analytics' }), { place: 'agent', agent: 'marketing', topic: 'analytics', group: 'rules' });
    assert.deepEqual(place({ domain: '_rule:x', project_id: 'p-1', content: marker('sales') }), { place: 'agent', agent: 'coder', topic: null, group: 'rules' });
  });

  test('shared rows are shared; what the page lists under no agent stays visible as other', () => {
    assert.deepEqual(place({ domain: '_rule:no-em-dashes', content: 'x' }), { place: 'shared', group: 'rules' });
    assert.deepEqual(place({ domain: '_command:weekly', content: 'x' }), { place: 'shared', group: 'shortcuts' });
    assert.deepEqual(place({ domain: '_rule:x', department: 'orchestrator' }), { place: 'other', owner: 'orchestrator', group: 'rules' });
    assert.deepEqual(place({ domain: 'pipeline-notes', department: 'sales' }), { place: 'other', owner: 'sales', group: 'notes' });
    assert.deepEqual(place({ domain: '_rule:x', department: 'graphic_design' }), { place: 'other', owner: 'graphic_design', group: 'rules' });
  });

  test('read-only here: shared rules and skills and every _account:* row; owned rows are not', () => {
    assert.equal(owner.isReadOnlyRow({ domain: '_rule:x', content: 'x' }), true);
    assert.equal(owner.isReadOnlyRow({ domain: '_skill:x', content: 'x' }), true);
    assert.equal(owner.isReadOnlyRow({ domain: '_account:soul' }), true);
    assert.equal(owner.isReadOnlyRow({ domain: '_account:pronunciations' }), true);
    assert.equal(owner.isReadOnlyRow({ domain: '_workspace:x' }), true);
    // Negative controls.
    assert.equal(owner.isReadOnlyRow({ domain: '_rule:x', department: 'sales' }), false);
    assert.equal(owner.isReadOnlyRow({ domain: 'sales' }), false);
    assert.equal(owner.isReadOnlyRow({ domain: '_identity:orchestrator', content: '---\nname: Iris\n---\n' }), false);
    assert.match(owner.readOnlyReason(place({ domain: '_rule:x' })), /shared with every agent.*Memory page/);
    assert.match(owner.readOnlyReason(place({ domain: '_account:soul' })), /chief of staff/);
  });

  test('a shared kind the Memory page does not change stays editable here (review F2)', () => {
    // The Memory page's shared editor takes rules and skills only (any other kind is a 404 there).
    const shared = [
      { domain: '_command:weekly-report', content: '# weekly-report\n\n(Write the command content here, then save.)\n' },
      { domain: '_agent:closer', content: 'x' },
      { domain: 'competitors', content: 'Acme undercuts us.' },
      { domain: '_identity:patrick', content: '---\nname: Patrick\n---\n' },
    ];
    for (const row of shared) {
      const placement = place(row);
      assert.equal(placement.place, 'shared', row.domain);
      assert.equal(owner.isReadOnlyRow(row, placement), false, row.domain);
      assert.equal(owner.isSharedChangedHere(placement), true, row.domain);
    }
    // Negative controls: the page's own kinds, and a row an agent owns.
    assert.equal(owner.isSharedChangedHere(place({ domain: '_rule:x', content: 'x' })), false);
    assert.equal(owner.isSharedChangedHere(place({ domain: '_skill:x', content: 'x' })), false);
    assert.equal(owner.isSharedChangedHere(place({ domain: '_command:x', department: 'ppc' })), false);
  });
});

describe('the Memory page address', () => {
  test('account-scoped, at an agent, a topic, an item or a part', () => {
    assert.equal(owner.memoryPageUrl('https://app.hiveku.com/', ACCOUNT), BASE);
    assert.equal(owner.memoryPageUrl(undefined, ACCOUNT, { agent: 'sales', item: '_rule:no discounts' }), `${BASE}?agent=sales&item=_rule%3Ano+discounts`);
    assert.equal(owner.memoryPageUrl(undefined, ACCOUNT, { agent: 'seo' }), `${BASE}?agent=seo`);
    assert.equal(owner.memoryPageUrl(undefined, ACCOUNT, { open: 'voice' }), `${BASE}?open=voice`);
    // A key that is no agent or topic opens the page itself; a bad account id the unscoped page.
    assert.equal(owner.memoryPageUrl(undefined, ACCOUNT, { agent: 'graphic_design', item: 'x' }), BASE);
    assert.equal(owner.memoryPageUrl(undefined, 'x/../y', { agent: 'sales' }), 'https://app.hiveku.com/dashboard/memory?agent=sales');
  });

  test('"Open in Memory" for each place', () => {
    const link = (row) => owner.memoryLinkFor(owner.placeRow(row), row.domain);
    assert.deepEqual(link({ domain: '_rule:x', department: 'sales' }), { agent: 'sales', item: '_rule:x' });
    assert.deepEqual(link({ domain: '_rule:x', department: 'marketing', content: marker('seo') }), { agent: 'seo', item: '_rule:x' });
    assert.deepEqual(link({ domain: '_account:soul' }), { agent: 'orchestrator', item: '_account:soul' });
    assert.deepEqual(link({ domain: '_account:voice_settings' }), { open: 'voice' });
    assert.deepEqual(link({ domain: '_rule:x', content: 'x' }), {}, 'shared: the page, where About your business holds them');
    assert.deepEqual(link({ domain: '_rule:x', department: 'orchestrator' }), { agent: 'orchestrator' });
  });
});

describe('+ New entry (audit G7)', () => {
  test('offers every agent that follows what is filed for it, in the page order and words', () => {
    const agents = owner.newEntryAgents();
    const keys = agents.map((a) => a.key);
    for (const key of ['sales', 'helpdesk', 'comms', 'production', 'accounting', 'coder', 'marketing', 'seo', 'ppc', 'email', 'customer_avatar']) {
      assert.ok(keys.includes(key), key);
    }
    // Not the chief of staff (she reads only her own _account:* memory), not
    // shared with every agent, and not a department the agent servers do not follow yet.
    for (const key of ['orchestrator', 'shared', 'analytics']) assert.ok(!keys.includes(key), key);
    assert.deepEqual(agents.slice(0, 6).map((a) => a.label), ['Sales', 'Support', 'Communications', 'Production', 'Accounting', 'Website']);
    assert.equal(agents.find((a) => a.key === 'marketing').label, 'Marketing strategy');
    assert.equal(agents.find((a) => a.key === 'ppc').label, 'Paid ads');
  });

  test('names follow the builder: kebab-case, and the stored name fits in 50 characters', () => {
    assert.equal(owner.newEntryNameError('rule', 'refund-policy'), undefined);
    for (const bad of ['Refund', 'refund_policy', '-x', 'x-', 'a', 'has space', '']) {
      assert.ok(owner.newEntryNameError('rule', bad), bad);
    }
    assert.equal(owner.newEntryNameError('rule', 'r'.repeat(44)), undefined, '_rule: + 44 = 50');
    assert.ok(owner.newEntryNameError('rule', 'r'.repeat(45)));
    assert.ok(owner.newEntryNameError('command', 'c'.repeat(42)), '_command: + 42 > 50');
    assert.equal(owner.newEntryDomain('skill', 'sales', 'discovery-call'), '_skill:discovery-call');
    assert.equal(owner.newEntryDomain('memory', 'sales', 'ignored'), 'sales');
    assert.deepEqual(owner.newEntryOf('_rule:refund-policy', 'helpdesk'), { kind: 'rule', name: 'refund-policy' });
    assert.deepEqual(owner.newEntryOf('seo', 'seo'), { kind: 'memory', name: 'seo' });
    // Negative controls: another agent's notes, a bad name, an agent not offered.
    assert.equal(owner.newEntryOf('sales', 'seo'), null);
    assert.equal(owner.newEntryOf('_rule:Bad_Name', 'sales'), null);
    assert.equal(owner.newEntryOf('_rule:ok-name', 'orchestrator'), null);
  });

  test('the marker goes on the first line, or right after front matter', () => {
    assert.equal(owner.withDepartmentMarker('Never discount.', 'sales'), '<!-- department: sales -->\nNever discount.');
    assert.equal(
      owner.withDepartmentMarker('---\ndescription: Weekly tune\n---\nStep 1', 'ppc'),
      '---\ndescription: Weekly tune\n---\n<!-- department: ppc -->\nStep 1',
    );
  });

  test("who else follows an entry, by the builder's follow rule (review F4)", () => {
    // Every Marketing topic follows the Marketing lead's; the website agent follows the lead's and the website topics'.
    assert.deepEqual(owner.alsoFollowedBy('marketing'), ['every Marketing topic', 'the Website agent']);
    for (const topic of ['branding', 'content', 'website_design', 'customer_avatar', 'customer_journey', 'knowledge_base', 'before_after_grid']) {
      assert.deepEqual(owner.alsoFollowedBy(topic, 'rule'), ['the Website agent'], topic);
    }
    // SEO: its skills only, never its rules.
    assert.deepEqual(owner.alsoFollowedBy('seo', 'skill'), ['the Website agent']);
    assert.deepEqual(owner.alsoFollowedBy('seo', 'rule'), []);
    assert.deepEqual(owner.alsoFollowedBy('seo'), []);
    // Notes are their owner's own; the other agents and topics are followed by no one else.
    assert.deepEqual(owner.alsoFollowedBy('marketing', 'memory'), []);
    for (const key of ['sales', 'helpdesk', 'comms', 'production', 'accounting', 'coder', 'ppc', 'email', 'social', 'outbound', 'workflow']) {
      assert.deepEqual(owner.alsoFollowedBy(key, 'skill'), [], key);
    }
    // The same owner set the builder pins (team-keys.ts WEBSITE_AGENT_FOLLOWS, the ownership fixture).
    assert.deepEqual(owner.WEBSITE_AGENT_FOLLOWED_OWNERS, ['marketing', 'branding', 'content', 'website_design', 'customer_avatar', 'customer_journey', 'knowledge_base', 'before_after_grid']);
    assert.deepEqual(owner.WEBSITE_AGENT_FOLLOWED_SKILL_OWNERS, ['seo']);
  });
});

describe('a save keeps the entry with its agent', () => {
  const stored = { domain: '_rule:refunds', department: 'helpdesk', content: `${marker('helpdesk')}\nRefunds within 30 days.` };

  test('a marker line the edit dropped is put back', () => {
    const check = owner.checkOwnerOnSave(stored, 'Refunds within 14 days.');
    assert.equal(check.ok, true);
    assert.equal(check.kept, 'helpdesk');
    assert.equal(check.text, `${marker('helpdesk')}\nRefunds within 14 days.`);
  });

  test('a marker changed to another agent is refused; one that names the owner is not', () => {
    assert.deepEqual(owner.checkOwnerOnSave(stored, `${marker('sales')}\nRefunds.`), { ok: false, from: 'helpdesk', to: 'sales' });
    // A column-owned row with no marker cannot be pointed at another agent by adding one.
    assert.deepEqual(
      owner.checkOwnerOnSave({ domain: '_rule:x', department: 'sales', content: 'x' }, `${marker('seo')}\nx`),
      { ok: false, from: 'sales', to: 'seo' },
    );
    // Negative controls: unchanged, fixed to agree with the owner, or a mismatch that was already there.
    assert.deepEqual(owner.checkOwnerOnSave(stored, `${marker('helpdesk')}\nNew text.`), { ok: true, text: `${marker('helpdesk')}\nNew text.`, kept: null });
    assert.equal(owner.checkOwnerOnSave({ domain: '_rule:x', department: 'sales', content: marker('seo') }, `${marker('sales')}\nx`).ok, true);
    assert.equal(owner.checkOwnerOnSave({ domain: '_rule:x', department: 'sales', content: marker('seo') }, `${marker('seo')}\nx`).ok, true);
  });

  test('profiles and notes are saved as written', () => {
    assert.deepEqual(owner.checkOwnerOnSave({ domain: 'sales', content: marker('sales') }, 'plain'), { ok: true, text: 'plain', kept: null });
    assert.deepEqual(owner.checkOwnerOnSave({ domain: '_identity:sales', content: marker('sales') }, 'x'), { ok: true, text: 'x', kept: null });
  });
});

describe('the department list', () => {
  test('knowledge.ts DEPARTMENTS is every department an entry can belong to, Analytics included', () => {
    const slugs = knowledge.DEPARTMENTS.map((d) => d.slug);
    assert.deepEqual([...slugs].sort(), [...owner.MEMORY_DEPARTMENTS].sort());
    for (const key of ['comms', 'production', 'accounting', 'orchestrator', 'coder', 'analytics', 'customer_avatar', 'customer_journey', 'website_design', 'before_after_grid']) {
      assert.ok(slugs.includes(key), key);
    }
    assert.equal(new Set(slugs).size, slugs.length, 'no duplicates');
    assert.equal(knowledge.departmentLabel('helpdesk'), 'Support');
    assert.equal(knowledge.departmentLabel('shared'), 'Shared with every agent');
  });
});
