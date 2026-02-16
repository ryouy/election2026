(function () {
  'use strict';

  window.App = window.App || {};
  App.ui = App.ui || {};

  const state = App.state;

  function getBaseFromColumn(col) {
    const i = col.indexOf('-');
    return i >= 0 ? col.slice(0, i) : col;
  }

  function getSuffixNumber(col) {
    const i = col.indexOf('-');
    if (i < 0) return null;
    const n = parseInt(col.slice(i + 1), 10);
    return Number.isFinite(n) ? n : null;
  }

  function labelForColumn(col) {
    if (!state.questionManifest) return col;
    const base = getBaseFromColumn(col);
    if (base === 'Q25' && state.questionManifest.q25_labels && state.questionManifest.q25_labels[col]) {
      return state.questionManifest.q25_labels[col];
    }
    const n = getSuffixNumber(col);
    if (n == null) return col;
    if (base === 'Q1' || base === 'Q24') return `${base}（${n}つ目）`;
    return `${base}-${n}`;
  }

  function decodeValue(base, rawValue, optionsMap) {
    if (rawValue == null) return '-';
    if (rawValue === '-' || rawValue === '') return '-';
    if ((base === 'Q1' || base === 'Q24') && optionsMap) {
      const label = optionsMap[String(rawValue)];
      return label ? `${rawValue}:${label}` : String(rawValue);
    }
    return String(rawValue);
  }

  function buildTooltipHTML(data) {
    const name = data?.name ?? '';
    const party = data?.party ?? '';
    const base = state.currentQuestion?.base ?? '';
    const cols = state.currentQuestion?.columns ?? [];
    const optionsMap = state.currentQuestion?.optionsMap ?? {};

    const lines = cols
      .map((col) => {
        const v = decodeValue(base, data?.[col], optionsMap);
        const label = labelForColumn(col);
        return `<span class="tooltip-label">${label}:</span> <span class="tooltip-value">${v}</span>`;
      })
      .join('<br>');

    return `
      <strong>${name}</strong><br>
      <span class="tooltip-label">政党:</span> <span class="tooltip-value">${party}</span><br>
      <span class="tooltip-label">クラスタ:</span> <span class="tooltip-value">${data?.cluster_global ?? '-'}</span><br>
      <span class="tooltip-label">党内主流クラスタ:</span> <span class="tooltip-value">${data?.party_mode_cluster ?? '-'}</span><br>
      <span class="tooltip-label">ズレ度:</span> <span class="tooltip-value">${data?.mismatch_score != null ? Number(data.mismatch_score).toFixed(2) : '-'}</span>
      ${data?.is_mismatch ? `<span class="tooltip-value" style="margin-left:8px; color:#d62728;">(ズレ)</span>` : ''}
      <br><br>
      ${lines}
    `;
  }

  function resetOptionFilter() {
    state.optionFilter = { active: false, column: '*', value: null };
    updateOptionChipsSelectionUI();
  }

  function updateOptionChipsSelectionUI() {
    const chips = document.querySelectorAll('#option-chips .chip');
    chips.forEach((ch) => {
      const v = ch.getAttribute('data-value');
      if (state.optionFilter.active && String(state.optionFilter.value) === String(v)) ch.classList.add('selected');
      else ch.classList.remove('selected');
    });
  }

  function candidateMatchesOption(data) {
    if (!state.optionFilter.active) return true;
    if (!data) return false;
    const v = String(state.optionFilter.value);
    const cols = state.currentQuestion?.columns ?? [];
    const col = state.optionFilter.column;
    const matchIn = (c) => {
      const raw = data[c];
      if (raw == null) return false;
      if (raw === '-' || raw === '') return false;
      return String(raw) === v;
    };
    if (col && col !== '*') return matchIn(col);
    return cols.some(matchIn);
  }

  function buildOptionFilterUI() {
    const box = document.getElementById('option-filter');
    const colSel = document.getElementById('column-select');
    const chipsWrap = document.getElementById('option-chips');
    const clearBtn = document.getElementById('clear-option');
    if (!box || !colSel || !chipsWrap || !clearBtn) return;

    const cols = state.currentQuestion?.columns ?? [];
    const optionsMap = state.currentQuestion?.optionsMap ?? {};

    // columns select
    colSel.innerHTML = '';
    if (cols.length <= 1) {
      const opt = document.createElement('option');
      opt.value = cols[0] ?? '*';
      opt.textContent = cols[0] ? labelForColumn(cols[0]) : '（対象なし）';
      colSel.appendChild(opt);
      state.optionFilter.column = cols[0] ?? '*';
    } else {
      const any = document.createElement('option');
      any.value = '*';
      any.textContent = '（どれでも）';
      colSel.appendChild(any);
      cols.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = labelForColumn(c);
        colSel.appendChild(opt);
      });
      const prev = state.optionFilter.column;
      if (prev && (prev === '*' || cols.includes(prev))) colSel.value = prev;
      else colSel.value = '*';
      state.optionFilter.column = colSel.value;
    }

    colSel.onchange = () => {
      state.optionFilter.column = colSel.value;
    };

    clearBtn.onclick = () => resetOptionFilter();

    // chips
    const keys = Object.keys(optionsMap || {});
    if (!keys.length) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';

    const sortable = keys.map((k) => {
      const n = Number(k);
      return { k, n: Number.isFinite(n) ? n : null, label: optionsMap[k] };
    });
    sortable.sort((a, b) => {
      if (a.n != null && b.n != null) return a.n - b.n;
      if (a.n != null) return -1;
      if (b.n != null) return 1;
      return String(a.k).localeCompare(String(b.k), 'ja');
    });

    chipsWrap.innerHTML = '';
    sortable.forEach(({ k, label }) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.setAttribute('data-value', String(k));
      chip.textContent = `${k}: ${label}`;
      chip.onclick = () => {
        if (state.optionFilter.active && String(state.optionFilter.value) === String(k)) {
          resetOptionFilter();
        } else {
          state.optionFilter.active = true;
          state.optionFilter.value = String(k);
          updateOptionChipsSelectionUI();
        }
      };
      chipsWrap.appendChild(chip);
    });
    updateOptionChipsSelectionUI();
  }

  function updateQuestionUI(base) {
    const sel = document.getElementById('question-select');
    const title = document.getElementById('question-title');
    const metaEl = document.getElementById('question-meta');
    const q = state.questionManifest?.questions?.find((x) => x.base === base);
    if (!q) return;
    if (sel) sel.value = base;
    if (title) title.textContent = q.question_full;

    if (metaEl && state.currentEmbeddingMeta) {
      const m = state.currentEmbeddingMeta || {};
      const method = m.method || '';
      const ncl = m.n_clusters != null ? ` / clusters=${m.n_clusters}` : '';
      metaEl.textContent = method ? `embedding: ${method}${ncl}` : '';
    } else if (metaEl) {
      metaEl.textContent = '';
    }
  }

  function updatePartySelectOptions() {
    const sel = document.getElementById('party-select');
    if (!sel) return;
    const parties = Array.from(new Set((state.pointsData || []).map((p) => p.party))).sort((a, b) => a.localeCompare(b, 'ja'));
    const prev = sel.value;
    sel.innerHTML = '<option value="">（政党を選択）</option>';
    parties.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      sel.appendChild(opt);
    });
    if (prev && parties.includes(prev)) sel.value = prev;
  }

  App.ui.labelForColumn = labelForColumn;
  App.ui.decodeValue = decodeValue;
  App.ui.buildTooltipHTML = buildTooltipHTML;
  App.ui.resetOptionFilter = resetOptionFilter;
  App.ui.updateOptionChipsSelectionUI = updateOptionChipsSelectionUI;
  App.ui.candidateMatchesOption = candidateMatchesOption;
  App.ui.buildOptionFilterUI = buildOptionFilterUI;
  App.ui.updateQuestionUI = updateQuestionUI;
  App.ui.updatePartySelectOptions = updatePartySelectOptions;
})();


