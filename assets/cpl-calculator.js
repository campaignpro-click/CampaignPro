/* Break-even cost per lead calculator (google-ads-cost-per-lead-calculator.html).
   Pure maths lives in bcCalc() so it can be tested in Node; the rest wires it to the page. */
(function (root) {
  'use strict';

  var TARGET_SHARE = 0.5; // "healthy profit" target: keep half of the gross profit per lead

  // Accepts "2,000", "$2000", "40%", " 12.5 " ... returns a number, or NaN when empty/invalid.
  function parseNum(v) {
    if (v === null || v === undefined) return NaN;
    var s = String(v).replace(/[\s$,%]/g, '');
    if (s === '') return NaN;
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
    return parseFloat(s);
  }

  // in: { revenue, jobs, margin (%), close (%), cpl?, spend?, fee? }  (all numbers or NaN)
  // out: { errors: {field: msg}, ok: bool, ...results }
  function bcCalc(i) {
    var errors = {};
    function need(field, label, min, max) {
      var v = i[field];
      if (isNaN(v)) { errors[field] = 'Enter ' + label + '.'; return; }
      if (v <= min) { errors[field] = label.charAt(0).toUpperCase() + label.slice(1) + ' must be greater than ' + min + '.'; return; }
      if (max !== undefined && v > max) { errors[field] = label.charAt(0).toUpperCase() + label.slice(1) + ' can\'t be more than ' + max + '.'; }
    }
    need('revenue', 'what a new customer pays you', 0);
    need('jobs', 'how many jobs or purchases a customer makes', 0);
    need('margin', 'your profit margin (%)', 0, 100);
    need('close', 'your lead-to-customer rate (%)', 0, 100);

    var optional = { cpl: 'your cost per lead', spend: 'your monthly ad spend', fee: 'your management fee' };
    Object.keys(optional).forEach(function (f) {
      var v = i[f];
      if (!isNaN(v) && v < 0) errors[f] = 'Enter a number of zero or more.';
    });

    if (Object.keys(errors).length) return { ok: false, errors: errors };

    var margin = i.margin / 100, close = i.close / 100;
    var revenuePerCustomer = i.revenue * i.jobs;
    var profitPerCustomer = revenuePerCustomer * margin;
    var out = {
      ok: true,
      errors: errors,
      revenuePerCustomer: revenuePerCustomer,
      profitPerCustomer: profitPerCustomer,
      breakEvenCpl: profitPerCustomer * close,
      targetCpl: profitPerCustomer * close * TARGET_SHARE,
      breakEvenCac: profitPerCustomer,
      revenuePerLead: revenuePerCustomer * close,
      breakEvenRoas: 1 / margin,
      verdict: null,
      monthly: null
    };

    var hasCpl = !isNaN(i.cpl) && i.cpl > 0;
    if (hasCpl) {
      var status = i.cpl <= out.targetCpl ? 'healthy' : (i.cpl <= out.breakEvenCpl ? 'thin' : 'losing');
      out.verdict = {
        status: status,
        cpl: i.cpl,
        costPerCustomer: i.cpl / close,
        profitPerLead: out.breakEvenCpl - i.cpl,
        roas: out.revenuePerLead / i.cpl
      };
    }

    var hasSpend = !isNaN(i.spend) && i.spend > 0;
    if (hasCpl && hasSpend) {
      var fee = isNaN(i.fee) ? 0 : i.fee;
      var leads = i.spend / i.cpl;
      var customers = leads * close;
      var gross = customers * profitPerCustomer;
      out.monthly = {
        spend: i.spend,
        fee: fee,
        leads: leads,
        customers: customers,
        revenue: customers * revenuePerCustomer,
        grossProfit: gross,
        net: gross - i.spend - fee,
        allInCpl: fee > 0 ? (i.spend + fee) / leads : i.cpl
      };
    }
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { bcCalc: bcCalc, parseNum: parseNum };
  }
  if (typeof document === 'undefined') return;

  /* ---------- page wiring ---------- */
  var form = document.getElementById('bc-form');
  if (!form) return;

  var $ = function (id) { return document.getElementById(id); };
  var fields = ['revenue', 'jobs', 'margin', 'close', 'cpl', 'spend', 'fee'];
  var examples = { revenue: '2000', jobs: '1', margin: '40', close: '20', cpl: '', spend: '', fee: '' };
  var tracked = false;

  function money(n) {
    var abs = Math.abs(n);
    var digits = abs >= 100 || Math.abs(abs - Math.round(abs)) < 0.005 ? 0 : 2;
    var s = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return (n < 0 ? '-$' : '$') + s;
  }
  function count(n) {
    return n >= 10 ? Math.round(n).toLocaleString('en-US') : (Math.round(n * 10) / 10).toLocaleString('en-US');
  }
  function times(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US') + '×'; }
  function pct(n) { return Math.round(n * 100).toLocaleString('en-US') + '%'; }
  function text(id, v) { var el = $(id); if (el) el.textContent = v; }
  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }

  function read() {
    var o = {};
    fields.forEach(function (f) { o[f] = parseNum($('bc-' + f).value); });
    return o;
  }

  function render() {
    var r = bcCalc(read());

    fields.forEach(function (f) {
      var inp = $('bc-' + f), err = $('bc-' + f + '-err');
      var msg = r.errors && r.errors[f];
      // Empty fields are explained by the results panel; only flag values that were actually typed
      if (msg && inp.value.trim() === '') msg = '';
      inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (err) { err.textContent = msg || ''; err.hidden = !msg; }
    });

    var results = $('bc-results');
    results.setAttribute('data-state', r.ok ? 'ready' : 'empty');
    show('bc-empty', !r.ok);
    show('bc-ready', r.ok);
    if (!r.ok) return;

    text('bc-main', money(r.breakEvenCpl));
    text('bc-target', money(r.targetCpl));
    text('bc-cac', money(r.breakEvenCac));
    text('bc-roas', times(r.breakEvenRoas) + ' (' + pct(r.breakEvenRoas) + ')');
    text('bc-rpl', money(r.revenuePerLead));

    var v = r.verdict, box = $('bc-verdict');
    show('bc-verdict', !!v);
    if (v) {
      box.setAttribute('data-status', v.status);
      var label = { healthy: 'Healthy', thin: 'Profitable, but thin', losing: 'Losing money on each lead' }[v.status];
      text('bc-verdict-label', label);
      var body;
      if (v.status === 'losing') {
        body = 'At ' + money(v.cpl) + ' per lead you pay about ' + money(v.costPerCustomer) + ' to win a customer who brings ' + money(r.profitPerCustomer) +
          ' in profit, so each lead loses roughly ' + money(-v.profitPerLead) + '. Fix tracking, wasted searches and the landing page before adding budget.';
      } else if (v.status === 'thin') {
        body = 'At ' + money(v.cpl) + ' per lead you stay above break-even, but only about ' + money(v.profitPerLead) +
          ' of profit is left per lead. Bringing it toward ' + money(r.targetCpl) + ' would make growth much safer.';
      } else {
        body = 'At ' + money(v.cpl) + ' per lead you keep about ' + money(v.profitPerLead) +
          ' of gross profit per lead after ad cost. That is room to scale budget gradually while you watch your cost per lead.';
      }
      text('bc-verdict-body', body + ' Your return on ad spend is about ' + times(v.roas) + ' against a break-even of ' + times(r.breakEvenRoas) + '.');
    }

    var m = r.monthly;
    show('bc-monthly', !!m);
    if (m) {
      text('bc-m-leads', count(m.leads));
      text('bc-m-customers', count(m.customers));
      text('bc-m-revenue', money(m.revenue));
      text('bc-m-gross', money(m.grossProfit));
      text('bc-m-net', money(m.net));
      text('bc-m-net-label', m.net >= 0 ? 'Estimated monthly profit after ad spend' + (m.fee > 0 ? ' and fee' : '') : 'Estimated monthly loss after ad spend' + (m.fee > 0 ? ' and fee' : ''));
      $('bc-m-net-row').setAttribute('data-sign', m.net >= 0 ? 'pos' : 'neg');
      show('bc-m-allin-row', m.fee > 0);
      if (m.fee > 0) text('bc-m-allin', money(m.allInCpl));
    }
  }

  function track() {
    if (tracked) return;
    tracked = true;
    try {
      if (window.gtag) gtag('event', 'calculator_used', { calculator: 'break_even_cpl' });
      if (window.clarity) clarity('event', 'calculator_used');
    } catch (e) { /* analytics must never break the tool */ }
  }

  form.addEventListener('input', function () { render(); track(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); render(); track(); });
  form.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t && t.tagName === 'INPUT' && t.getAttribute('data-example') === 'true') {
      t.select();
      t.removeAttribute('data-example');
    }
  });

  var resetBtn = $('bc-reset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    fields.forEach(function (f) { $('bc-' + f).value = examples[f]; });
    render();
  });
  var clearBtn = $('bc-clear');
  if (clearBtn) clearBtn.addEventListener('click', function () {
    fields.forEach(function (f) { $('bc-' + f).value = ''; });
    render();
    $('bc-revenue').focus();
  });

  render();
})(typeof window !== 'undefined' ? window : this);
