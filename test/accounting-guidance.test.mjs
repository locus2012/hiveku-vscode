/**
 * What the Accounting department tells an agent, and which lists it downloads,
 * after the Payables and Payroll rules changed (builder, 2026-10-06 to 10-08).
 *
 * The department's `crud` text and its first-run playbook are read verbatim
 * before an agent touches an account. Both still described the old rules:
 *   - "No accounting tool deletes, voids or reverses a recorded payment", while
 *     accounting_payment_reverse exists and is the only way to clear a mistyped
 *     bill payment;
 *   - a payment could be recorded on any bill (it is refused until the bill is
 *     approved);
 *   - an archived payroll member "is still paid" (they are not), and fixed pay
 *     was "the flat rate" (it is prorated to the period);
 *   - invoices could only come from an estimate (accounting_invoice_create
 *     writes one directly).
 * The tables had three columns that were always blank, because they read keys
 * the server never returns (pay_rate, member_count, a vendor currency).
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const { DEPARTMENTS } = loadOut('deptData');
const { ACCOUNTING_SETUP } = loadOut('setupPlaybooks');

const accounting = DEPARTMENTS.find((d) => d.id === 'accounting');
const dataset = (id) => accounting.datasets.find((d) => d.id === id);
const keysOf = (ds) => ds.columns.flatMap((c) => (Array.isArray(c.key) ? c.key : [c.key]));

describe('the Accounting department lists', () => {
  test('downloads products and services, recurring bills and time off', () => {
    assert.equal(dataset('products_services').tool, 'accounting_product_list');
    assert.equal(dataset('bill_schedules').tool, 'accounting_bill_schedules_list');
    assert.equal(dataset('pto_policies').tool, 'accounting_pto_policies_list');
    assert.equal(dataset('pto_balances').tool, 'accounting_pto_balances_list');
    assert.equal(dataset('pto_requests').tool, 'accounting_pto_requests_list');
    // The catalog pages at 200 at most; the default page is 50.
    assert.deepEqual(dataset('products_services').args, { limit: 200 });
    assert.ok(keysOf(dataset('products_services')).includes('default_unit_price_cents'));
  });

  test('reads the keys the server returns, so no column is always blank', () => {
    assert.ok(keysOf(dataset('members')).includes('pay_rate_cents'));
    assert.ok(!keysOf(dataset('members')).includes('pay_rate'), 'pay_rate is an argument, never a row key');
    assert.ok(keysOf(dataset('payroll_runs')).includes('_count.items'));
    assert.ok(!keysOf(dataset('vendors')).includes('target_currency'), 'a vendor has no currency');
  });

  test('downloads the payment pages with their links (2026-10-09)', () => {
    assert.equal(dataset('payment_pages').tool, 'accounting_payment_page_list');
    // The list route answers every page at once: no limit to pass.
    assert.equal(dataset('payment_pages').args, undefined);
    const keys = keysOf(dataset('payment_pages'));
    for (const key of ['title', 'is_active', 'collected_cents', 'share_url', 'id']) assert.ok(keys.includes(key), key);
    const collected = dataset('payment_pages').columns.find((c) => c.key === 'collected_cents');
    assert.ok(collected.money && collected.cents, 'collected_cents is cents');
  });

  test('leaves leave dates as written, since the console reads a date in local time', () => {
    const dated = dataset('pto_requests').columns.filter((c) => c.date);
    assert.deepEqual(dated, []);
  });
});

describe('what the Accounting department teaches', () => {
  const crud = accounting.crud;

  test('a bill payment can be undone, and only one way', () => {
    assert.match(crud, /`accounting_payment_reverse`/);
    assert.doesNotMatch(crud, /No accounting tool deletes, voids or reverses/);
    assert.match(ACCOUNTING_SETUP, /accounting_payment_reverse\(\{ bill_id, payment_id, reason \}\)/);
    assert.doesNotMatch(ACCOUNTING_SETUP, /has no payment reversal/);
  });

  test('approval comes before payment', () => {
    assert.match(crud, /Approve this bill before recording a payment\./);
    assert.match(ACCOUNTING_SETUP, /Approve this bill before recording a payment\./);
  });

  test('archived people are not paid, fixed pay is prorated, a period is paid once', () => {
    assert.match(crud, /leaves out anyone archived or not `active`/);
    assert.match(crud, /`overlapping_run_id`/);
    assert.doesNotMatch(crud, /gives fixed members the flat rate/);
    assert.doesNotMatch(ACCOUNTING_SETUP, /archiving alone leaves them being paid/);
  });

  test('time off and the products catalog are named', () => {
    assert.match(crud, /`accounting_pto_request_review`/);
    assert.match(crud, /`accounting_pto_balance_set`/);
    assert.match(crud, /`accounting_product_list`/);
    assert.match(crud, /`accounting_invoice_create`/);
  });

  test('payment pages: the five tools and the rules an agent would otherwise learn by failing', () => {
    for (const verb of ['create', 'update', 'delete']) assert.match(crud, new RegExp(`\`accounting_payment_page_${verb}\``));
    assert.match(crud, /`accounting_payment_page_get`/);
    assert.match(crud, /`payment_pages\.json`/);
    assert.match(crud, /`share_url`/);
    assert.match(crud, /409 `not_ready`/);
    assert.match(crud, /`config` replaces the extended settings whole/);
    assert.match(crud, /right to sell subscriptions \(403 otherwise\)/);
    assert.match(crud, /no tool restores it/);
  });

  test('a vendor tax ID is never read back in full, and the 1099 page is totals only', () => {
    assert.match(crud, /`tax_id_masked`/);
    assert.match(ACCOUNTING_SETUP, /tax_id_masked/);
    assert.match(ACCOUNTING_SETUP, /do not tell a user that 1099 filing is handled/);
  });
});
