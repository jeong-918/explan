/* 학생부 주제탐구 설계 스튜디오 — 상태는 메모리에만 보관, JSON 파일로 저장/불러오기 */
(function () {
  'use strict';
  const C = window.CURRICULUM || [];
  const F = window.FIELDS || [];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const norm = (s) => String(s || '').replace(/[\s·⋅・_]/g, '').replace(/II/g, 'Ⅱ').replace(/I/g, 'Ⅰ');
  const BY = new Map(C.map((c) => [norm(c.c), c]));
  const catKey = (k) => (k || '').split(' ')[0];
  const AREAS = ['교과 세특', '자율·자치활동', '동아리활동', '진로활동', '개인 탐구·기타'];
  const ALIAS = { '정치와법': ['정치', '법과 사회'], '영어독서와작문': ['영어 독해와 작문'], '수학Ⅰ': ['대수'], '수학Ⅱ': ['미적분Ⅰ'], '미적분': ['미적분Ⅰ', '미적분Ⅱ'], '생활과윤리': ['현대사회와 윤리'], '한국지리': ['한국지리 탐구'], '세계지리': ['세계시민과 지리'], '사회문화': ['사회와 문화'], '언어와매체': ['화법과 언어', '매체 의사소통'], '화법과작문': ['화법과 언어', '독서와 작문'], '물리학Ⅰ': ['물리학'], '화학Ⅰ': ['화학'], '생명과학Ⅰ': ['생명과학'], '지구과학Ⅰ': ['지구과학'], '물리학Ⅱ': ['역학과 에너지', '전자기와 양자'], '화학Ⅱ': ['물질과 에너지', '화학 반응의 세계'], '생명과학Ⅱ': ['세포와 물질대사', '생물의 유전'], '지구과학Ⅱ': ['지구시스템과학', '행성우주과학'], '통합사회': ['통합사회1', '통합사회2'], '통합과학': ['통합과학1', '통합과학2'], '한국사': ['한국사1', '한국사2'] };

  const blank = () => ({
    student: { name: '', grade: '2', apply: '2-1', fieldId: '', customField: '', depts: [], customDept: '', career: '', interest: '', school: '', g1note: '' },
    actMode: 'subject', acts: [], recordPaste: '',
    selected: [], rules: '', topicCount: 3, allowReuse: true,
    runMode: 'prompt', result: null, outlines: {},
  });
  let S = blank();
  let step = 1;
  let ui = { cluster: '전체', group: '전체', cat: '전체', q: '', fieldOnly: false };
  const API = { provider: 'openai', model: '', key: '', base: '' };
  const DEFAULT_MODEL = { openai: 'gpt-4.1', anthropic: 'claude-sonnet-4-5', gemini: 'gemini-2.5-pro', compat: 'sonar-pro' };

  // ---------- helpers ----------
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); }
  function field() { return F.find((f) => f.id === S.student.fieldId) || null; }
  function fieldCourses() { const f = field(); return f ? new Set([...f.core, ...f.recommended]) : new Set(); }
  function applyGrade() { return parseInt(S.student.apply.split('-')[0], 10); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function tagHTML(c) { const k = c.t ? '계열' : catKey(c.k); return `<span class="tag cat-${k}">${esc(c.t ? '계열 ' + c.k : c.k)}</span>`; }
  function gradeWarn(c) {
    const g = applyGrade();
    if (c.t) return '계열 선택 과목입니다(과학고·예술고·체육고 등 중심, 일반고는 공동교육과정 등으로 이수).';
    if (g === 1 && c.k !== '공통') return '1학년은 주로 공통 과목을 이수합니다. 학교 편성표에서 개설 여부를 확인하세요.';
    if (g >= 2 && c.k === '공통' && !/^(한국사|기본)/.test(c.c)) return `${g}학년 적용 시 공통 과목은 학교 편성에 따라 이수하지 않을 수 있습니다.`;
    return '';
  }
  function suggest(name) {
    const k = norm(name); if (!k) return [];
    if (ALIAS[k]) return ALIAS[k];
    return C.filter((c) => norm(c.c).includes(k) || k.includes(norm(c.c))).slice(0, 4).map((c) => c.c);
  }
  function download(name, text, type = 'text/markdown') {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  function fileStamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
  function safeName() { return (S.student.name || '학생').replace(/[\\/:*?"<>|\s]+/g, '_'); }

  // ---------- stepper ----------
  const STEPS = [['학생·진로', '학년, 계열, 학과'], ['기존 활동', '학년별·과목별 이력'], ['과목·규칙', '적용 과목, 지시사항'], ['주제 설계', '요청문 또는 API']];
  function stepDone(i) {
    if (i === 1) return !!(S.student.fieldId || S.student.customField);
    if (i === 2) return S.student.grade === '1' || S.acts.some((a) => a.title || a.concepts) || !!S.recordPaste.trim();
    if (i === 3) return S.selected.length > 0;
    if (i === 4) return !!S.result;
    return false;
  }
  function renderStepper() {
    $('#stepper').innerHTML = STEPS.map((s, i) => `<li><button type="button" class="step-btn ${stepDone(i + 1) ? 'done' : ''}" data-go="${i + 1}" ${step === i + 1 ? 'aria-current="step"' : ''}><span class="num">${stepDone(i + 1) && step !== i + 1 ? '✓' : i + 1}</span><span class="lbl">${s[0]}<span class="sub">${s[1]}</span></span></button></li>`).join('');
  }
  function go(n) {
    step = n;
    $$('.step').forEach((s) => (s.hidden = +s.dataset.step !== n));
    if (n === 2) renderStep2();
    if (n === 3) renderStep3();
    if (n === 4) renderStep4();
    renderStepper();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#main').focus({ preventScroll: true });
  }

  // ---------- step 1 ----------
  function renderApplyOptions() {
    const g = +S.student.grade; const opts = [];
    for (let y = g; y <= 3; y++) for (let s = 1; s <= 2; s++) opts.push(`${y}-${s}`);
    if (!opts.includes(S.student.apply)) S.student.apply = opts[0];
    $('#s-apply').innerHTML = opts.map((o) => `<option value="${o}" ${o === S.student.apply ? 'selected' : ''}>${o[0]}학년 ${o[2]}학기</option>`).join('');
  }
  function setSeg(el, v) { $$('button', el).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v))); }
  function renderClusters() {
    const cl = ['전체', ...new Set(F.map((f) => f.cluster))];
    $('#cluster-chips').innerHTML = cl.map((c) => `<button type="button" class="chip" data-cluster="${esc(c)}" aria-pressed="${ui.cluster === c}">${esc(c)}</button>`).join('');
    const list = F.filter((f) => ui.cluster === '전체' || f.cluster === ui.cluster);
    $('#field-grid').innerHTML = list.map((f) => `<button type="button" class="field-card" data-field="${f.id}" aria-pressed="${S.student.fieldId === f.id}"><span class="fc-no">${f.id}</span><span class="fc-name">${esc(f.name)}</span><span class="fc-cl">${esc(f.cluster)}</span></button>`).join('');
  }
  function renderFieldDetail() {
    const f = field(); const box = $('#field-detail');
    if (!f) { box.hidden = true; return; }
    box.hidden = false;
    const depts = [...new Set([...f.departments, ...S.student.depts.filter((d) => !f.departments.includes(d))])];
    box.innerHTML = `<div class="fd-head"><h3>${esc(f.id)} ${esc(f.name)}</h3><span class="tag cat-일반">${esc(f.cluster)}</span></div>
      <p class="fd-sum">${esc(f.summary)}</p>
      <div class="fd-row"><b>희망 학과 선택 (복수 가능)</b>${depts.map((d) => `<button type="button" class="dept" data-dept="${esc(d)}" aria-pressed="${S.student.depts.includes(d)}">${esc(d)}</button>`).join('')}
        <div class="grid-2" style="margin-top:.5rem"><input type="text" id="s-custom-dept" placeholder="목록에 없는 학과 입력 후 Enter" value=""></div></div>
      <div class="fd-row"><b>핵심 참고 과목</b>${f.core.map((c) => `<span class="kw">${esc(c)}</span>`).join('') || '<span class="hint">없음</span>'}</div>
      <div class="fd-row"><b>권장 참고 과목</b>${f.recommended.map((c) => `<span class="kw">${esc(c)}</span>`).join('') || '<span class="hint">없음</span>'}</div>
      <div class="fd-row"><b>계열 핵심 키워드</b>${f.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join('')}</div>
      <p class="hint" style="margin-top:.75rem">참고 과목은 프로젝트 계열 가이드 기준이며(과목명은 2022 개정 명칭으로 정정), 대학별 공식 권장과목은 각 대학 발표 자료로 확인하세요.</p>`;
  }
  function bindStep1() {
    $('#s-name').addEventListener('input', (e) => { S.student.name = e.target.value; renderSummary(); });
    $('#s-grade').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.student.grade = b.dataset.v; setSeg($('#s-grade'), b.dataset.v); renderApplyOptions(); renderSummary(); renderStepper(); });
    $('#s-apply').addEventListener('change', (e) => { S.student.apply = e.target.value; renderSummary(); });
    $('#cluster-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-cluster]'); if (!b) return; ui.cluster = b.dataset.cluster; renderClusters(); });
    $('#field-grid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-field]'); if (!b) return;
      const id = b.dataset.field;
      if (S.student.fieldId !== id) { S.student.fieldId = id; S.student.depts = []; } else { S.student.fieldId = ''; S.student.depts = []; }
      renderClusters(); renderFieldDetail(); renderSummary(); renderStepper();
    });
    $('#field-detail').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dept]'); if (!b) return;
      const d = b.dataset.dept; const i = S.student.depts.indexOf(d);
      if (i >= 0) S.student.depts.splice(i, 1); else S.student.depts.push(d);
      b.setAttribute('aria-pressed', String(i < 0)); renderSummary();
    });
    $('#field-detail').addEventListener('keydown', (e) => {
      if (e.target.id === 's-custom-dept' && e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v && !S.student.depts.includes(v)) S.student.depts.push(v); renderFieldDetail(); renderSummary(); $('#s-custom-dept').focus(); }
    });
    $('#s-custom-field').addEventListener('input', (e) => { S.student.customField = e.target.value; renderSummary(); renderStepper(); });
    $('#s-career').addEventListener('input', (e) => { S.student.career = e.target.value; });
    $('#s-interest').addEventListener('input', (e) => { S.student.interest = e.target.value; });
    $('#s-school').addEventListener('input', (e) => { S.student.school = e.target.value; });
  }
  function fillStep1() {
    $('#s-name').value = S.student.name; setSeg($('#s-grade'), S.student.grade); renderApplyOptions();
    $('#s-custom-field').value = S.student.customField; $('#s-career').value = S.student.career; $('#s-interest').value = S.student.interest; $('#s-school').value = S.student.school;
    renderClusters(); renderFieldDetail();
  }

  // ---------- step 2 ----------
  function newAct() { const g = Math.max(1, +S.student.grade - 1); return { id: uid(), grade: String(g), area: '교과 세특', course: '', title: '', concepts: '', result: '', questions: '' }; }
  function renderStep2() {
    const g1 = S.student.grade === '1';
    $('#grade1-note').hidden = !g1; $('#activity-wrap').hidden = g1;
    $('#g1-note').value = S.student.g1note;
    if (g1) return;
    if (!S.acts.length) S.acts.push(newAct());
    setSeg($('#act-mode'), S.actMode);
    $('#record-paste').value = S.recordPaste;
    renderActs();
  }
  function actHTML(a) {
    const maxG = Math.max(1, +S.student.grade - (S.student.apply.endsWith('-1') && S.student.apply[0] === S.student.grade ? 1 : 0));
    const gopts = [1, 2, 3].filter((x) => x <= Math.max(maxG, +S.student.grade)).map((x) => `<option value="${x}" ${+a.grade === x ? 'selected' : ''}>${x}학년</option>`).join('');
    const sug = a.course && !BY.has(norm(a.course)) ? suggest(a.course) : [];
    return `<div class="act" data-id="${a.id}">
      <label class="field"><span>학년</span><select data-k="grade">${gopts}</select></label>
      <label class="field"><span>영역</span><select data-k="area">${AREAS.map((x) => `<option ${a.area === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field c3"><span>과목 ${S.actMode === 'subject' ? '(과목별 정리 기준)' : '(교과 세특이면 입력)'}</span><input type="text" data-k="course" list="course-dl" value="${esc(a.course)}" placeholder="예: 통합사회1">${sug.length ? `<small class="hint">2022 개정 과목명이 아닙니다. 후보: ${esc(sug.join(', '))}</small>` : ''}</label>
      <div class="tools"><button type="button" class="icon-btn" data-dup title="복제" aria-label="활동 복제">⧉</button><button type="button" class="icon-btn" data-del title="삭제" aria-label="활동 삭제">✕</button></div>
      <div class="wide">
        <label class="field full"><span>탐구 주제·활동명</span><input type="text" data-k="title" value="${esc(a.title)}" placeholder="예: 우리 지역 버스 노선 개편 전후 이용객 변화 분석"></label>
        <label class="field"><span>활용 개념·소재·방법</span><textarea data-k="concepts" rows="2" placeholder="예: 접근성 지표, 교통카드 공공데이터, 막대그래프 비교">${esc(a.concepts)}</textarea></label>
        <label class="field"><span>결론·결과</span><textarea data-k="result" rows="2" placeholder="예: 환승 거점 주변은 증가, 외곽은 감소">${esc(a.result)}</textarea></label>
        <label class="field full"><span>남은 의문·한계 (다음 탐구의 출발점)</span><textarea data-k="questions" rows="2" placeholder="예: 인구 구조 차이를 통제하지 못함, 고령층 이동권은 어떻게 측정?">${esc(a.questions)}</textarea></label>
      </div></div>`;
  }
  function renderActs() {
    const list = $('#act-list');
    if (!S.acts.length) { list.innerHTML = '<div class="empty">아직 입력한 활동이 없습니다. ‘+ 활동 추가’로 시작하세요.</div>'; }
    else {
      const key = S.actMode === 'grade' ? (a) => `${a.grade}학년` : (a) => a.course || (a.area !== '교과 세특' ? a.area : '과목 미입력');
      const groups = new Map();
      [...S.acts].sort((x, y) => (S.actMode === 'grade' ? x.grade - y.grade : 0)).forEach((a) => { const k = key(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); });
      list.innerHTML = [...groups].map(([k, arr]) => `<div class="group-h">${esc(k)} <span class="count">${arr.length}건</span></div>${arr.map(actHTML).join('')}`).join('');
    }
    $('#act-count').textContent = `총 ${S.acts.filter((a) => a.title || a.concepts).length}건 입력됨`;
  }
  function bindStep2() {
    $('#g1-note').addEventListener('input', (e) => { S.student.g1note = e.target.value; });
    $('#act-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.actMode = b.dataset.v; setSeg($('#act-mode'), S.actMode); renderActs(); });
    $('#btn-add-act').addEventListener('click', () => { const a = newAct(); const last = S.acts[S.acts.length - 1]; if (last) { a.grade = last.grade; if (S.actMode === 'subject') a.course = last.course; } S.acts.push(a); renderActs(); const el = $(`.act[data-id="${a.id}"] [data-k="title"]`); el && el.focus(); });
    $('#act-list').addEventListener('input', (e) => {
      const card = e.target.closest('.act'); const k = e.target.dataset.k; if (!card || !k) return;
      const a = S.acts.find((x) => x.id === card.dataset.id); a[k] = e.target.value;
      $('#act-count').textContent = `총 ${S.acts.filter((x) => x.title || x.concepts).length}건 입력됨`; renderSummary(); renderStepper();
    });
    $('#act-list').addEventListener('change', (e) => { const k = e.target.dataset.k; if (k === 'grade' || k === 'course' || k === 'area') renderActs(); });
    $('#act-list').addEventListener('click', (e) => {
      const card = e.target.closest('.act'); if (!card) return;
      const i = S.acts.findIndex((x) => x.id === card.dataset.id);
      if (e.target.closest('[data-del]')) { S.acts.splice(i, 1); renderActs(); renderSummary(); }
      if (e.target.closest('[data-dup]')) { const c = { ...S.acts[i], id: uid(), title: '', result: '', questions: '' }; S.acts.splice(i + 1, 0, c); renderActs(); }
    });
    $('#record-paste').addEventListener('input', (e) => { S.recordPaste = e.target.value; renderStepper(); });
  }

  // ---------- step 3 ----------
  function renderStep3() {
    const groups = ['전체', ...new Set(C.map((c) => c.g))];
    $('#group-chips').innerHTML = groups.map((g) => `<button type="button" class="chip" data-group="${esc(g)}" aria-pressed="${ui.group === g}">${esc(g)}</button>`).join('');
    const cats = ['전체', '공통', '일반 선택', '진로 선택', '융합 선택'];
    $('#cat-chips').innerHTML = cats.map((k) => `<button type="button" class="chip" data-cat="${esc(k)}" aria-pressed="${ui.cat === k}">${esc(k)}</button>`).join('');
    $('#c-fieldonly').checked = ui.fieldOnly; $('#c-search').value = ui.q;
    $('#tc-val').textContent = S.topicCount; $('#r-rules').value = S.rules; $('#r-reuse').checked = S.allowReuse;
    renderCourses(); renderSelected();
  }
  function renderCourses() {
    const fc = fieldCourses(); const q = ui.q.trim();
    let list = C.filter((c) => (ui.group === '전체' || c.g === ui.group) && (ui.cat === '전체' || c.k === ui.cat) && (!ui.fieldOnly || fc.has(c.c)));
    const hits = new Map();
    if (q) {
      list = list.filter((c) => {
        if (c.c.includes(q)) return true;
        for (const u of c.u) { if (u.m && u.m.includes(q)) { hits.set(c.c, `(${u.n}) ${u.m}`); return true; } for (const s of u.s) if (s[1] && s[1].includes(q)) { hits.set(c.c, `[${s[0]}] ${s[1].slice(0, 60)}…`); return true; } }
        return false;
      });
    }
    list.sort((a, b) => (fc.has(b.c) - fc.has(a.c)));
    const sel = new Set(S.selected.map((s) => s.course));
    $('#course-list').innerHTML = list.length ? list.map((c) => `<li class="course ${sel.has(c.c) ? 'on' : ''}">
        <div class="cn"><b>${fc.has(c.c) ? '<span class="star" title="계열 참고 과목">★</span> ' : ''}${esc(c.c)}</b><small>${esc(c.g)} · 권장 ${esc(c.gr)} · 단원 ${c.u.length}개</small>${hits.has(c.c) ? `<span class="hit">${esc(hits.get(c.c))}</span>` : ''}</div>
        ${tagHTML(c)}
        <button type="button" class="btn btn-sm ${sel.has(c.c) ? 'btn-ghost' : 'btn-secondary'}" data-toggle="${esc(c.c)}">${sel.has(c.c) ? '선택 해제' : '선택'}</button></li>`).join('') : '<li class="empty">조건에 맞는 과목이 없습니다.</li>';
  }
  function renderSelected() {
    $('#sel-count').textContent = S.selected.length ? `${S.selected.length}과목` : '';
    if (!S.selected.length) { $('#sel-list').innerHTML = '<div class="empty">왼쪽 목록에서 탐구를 적용할 과목을 선택하세요.</div>'; return; }
    $('#sel-list').innerHTML = S.selected.map((s) => {
      const c = BY.get(norm(s.course)); const w = gradeWarn(c);
      return `<div class="sel" data-course="${esc(s.course)}"><div class="sel-top"><b>${esc(c.c)}</b>${tagHTML(c)}<button type="button" class="icon-btn" data-remove aria-label="${esc(c.c)} 제거">✕</button></div>
        ${w ? `<div class="warnline">${esc(w)}</div>` : ''}
        <details><summary class="hint" style="cursor:pointer;margin-top:.4rem">단원 지정 (선택, ${s.units.length ? s.units.length + '개 지정' : '미지정 시 전체 단원'})</summary>
        <div class="units">${c.u.map((u) => `<label><input type="checkbox" data-unit="${u.n}" ${s.units.includes(u.n) ? 'checked' : ''}><span>(${u.n}) ${esc(u.m || '영역 구분 없음 · 성취기준 ' + u.s.length + '개')}</span></label>`).join('')}</div></details>
        <textarea rows="2" data-memo placeholder="과목별 지시사항 (예: 수행평가 보고서, 미적분 개념 필수)">${esc(s.memo)}</textarea></div>`;
    }).join('');
  }
  function toggleCourse(name) {
    const i = S.selected.findIndex((s) => s.course === name);
    if (i >= 0) S.selected.splice(i, 1); else S.selected.push({ course: name, units: [], memo: '' });
    renderCourses(); renderSelected(); renderSummary(); renderStepper();
  }
  function bindStep3() {
    $('#group-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-group]'); if (!b) return; ui.group = b.dataset.group; renderStep3(); });
    $('#cat-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; ui.cat = b.dataset.cat; renderStep3(); });
    $('#c-search').addEventListener('input', (e) => { ui.q = e.target.value; renderCourses(); });
    $('#c-fieldonly').addEventListener('change', (e) => { ui.fieldOnly = e.target.checked; if (ui.fieldOnly && !field()) toast('먼저 STEP 1에서 계열을 선택하세요.'); renderCourses(); });
    $('#course-list').addEventListener('click', (e) => { const b = e.target.closest('[data-toggle]'); if (b) toggleCourse(b.dataset.toggle); });
    $('#sel-list').addEventListener('click', (e) => { const card = e.target.closest('.sel'); if (card && e.target.closest('[data-remove]')) toggleCourse(card.dataset.course); });
    $('#sel-list').addEventListener('change', (e) => {
      const card = e.target.closest('.sel'); if (!card || !e.target.dataset.unit) return;
      const s = S.selected.find((x) => x.course === card.dataset.course); const n = +e.target.dataset.unit;
      s.units = e.target.checked ? [...new Set([...s.units, n])].sort((a, b) => a - b) : s.units.filter((x) => x !== n);
      const sum = card.querySelector('summary'); sum.textContent = `단원 지정 (선택, ${s.units.length ? s.units.length + '개 지정' : '미지정 시 전체 단원'})`;
    });
    $('#sel-list').addEventListener('input', (e) => { const card = e.target.closest('.sel'); if (card && e.target.hasAttribute('data-memo')) S.selected.find((x) => x.course === card.dataset.course).memo = e.target.value; });
    $('#r-rules').addEventListener('input', (e) => { S.rules = e.target.value; });
    $('#r-reuse').addEventListener('change', (e) => { S.allowReuse = e.target.checked; });
    $('#tc-minus').addEventListener('click', () => { S.topicCount = Math.max(1, S.topicCount - 1); $('#tc-val').textContent = S.topicCount; renderSummary(); });
    $('#tc-plus').addEventListener('click', () => { S.topicCount = Math.min(5, S.topicCount + 1); $('#tc-val').textContent = S.topicCount; renderSummary(); });
  }

  // ---------- request text ----------
  function careerLine() {
    const f = field();
    const fl = f ? `${f.id} ${f.name}(${f.cluster})` : '';
    return [fl, S.student.customField && `직접 입력: ${S.student.customField}`].filter(Boolean).join(' / ') || '미입력';
  }
  function actLines() {
    const acts = S.acts.filter((a) => a.title || a.concepts || a.result);
    const sorted = S.actMode === 'grade' ? [...acts].sort((a, b) => a.grade - b.grade) : [...acts].sort((a, b) => (a.course || 'ㅎ').localeCompare(b.course || 'ㅎ', 'ko'));
    return sorted.map((a) => `- ${a.grade}학년 | ${a.area} | ${a.course || '-'} | 주제: ${a.title || '-'} | 개념·소재: ${a.concepts || '-'} | 결론: ${a.result || '-'} | 남은 의문·한계: ${a.questions || '-'}`);
  }
  function courseLines() {
    return S.selected.map((s, i) => {
      const c = BY.get(norm(s.course));
      const units = s.units.length ? s.units.map((n) => { const u = c.u.find((x) => x.n === n); return `(${n}) ${u.m || '영역 구분 없음'}`; }).join(', ') : '전체 단원 중 적합한 단원';
      return `${i + 1}. ${c.c} [${c.g} · ${c.t ? '계열 ' : ''}${c.k} · 권장 ${c.gr}] — 지정 단원: ${units}${s.memo ? ` | 과목별 지시: ${s.memo}` : ''}`;
    });
  }
  function buildRequest() {
    const st = S.student; const g1 = st.grade === '1';
    const L = [];
    L.push('[주제탐구 설계 요청]');
    L.push('※ 학생부 주제탐구 설계 스튜디오에서 생성한 요청입니다. 프로젝트 스킬(student-record-inquiry-designer) 절차에 따라 과목·단원·성취기준을 검증하고 사실관계를 확인해 설계해 주세요.');
    L.push('');
    L.push(`■ 학생: ${st.name || '(미기재)'} | 현재 학년: ${st.grade}학년 | 적용 시기: ${st.apply[0]}학년 ${st.apply[2]}학기`);
    L.push(`■ 진로 희망: ${careerLine()} / 희망 학과: ${st.depts.join(', ') || '미선택'}`);
    if (st.career.trim()) L.push(`■ 진로 희망 상세: ${st.career.trim()}`);
    if (st.interest.trim()) L.push(`■ 관심 키워드·피하고 싶은 소재: ${st.interest.trim()}`);
    if (st.school.trim()) L.push(`■ 학교 정보: ${st.school.trim()}`);
    L.push('');
    if (g1) {
      L.push('■ 기존 활동: 1학년이므로 생략(출발 서사로 설계)');
      if (st.g1note.trim()) L.push(`■ 참고 경험: ${st.g1note.trim()}`);
    } else {
      const al = actLines();
      L.push(`■ 기존 활동 (${S.actMode === 'grade' ? '학년별' : '과목별'} 정리, ${al.length}건)`);
      L.push(...(al.length ? al : ['- (입력 없음: 필요 시 질문해 주세요)']));
      if (S.recordPaste.trim()) { L.push(''); L.push('■ 학생부 원문 발췌'); L.push(S.recordPaste.trim()); }
    }
    L.push('');
    L.push(`■ 적용 과목 (${S.selected.length}과목)`);
    L.push(...(S.selected.length ? courseLines() : ['- (미선택: 필요 시 질문해 주세요)']));
    L.push('');
    L.push(`■ 탐구 규칙·지시사항: ${S.rules.trim() || '별도 규칙 없음'}`);
    L.push(`■ 설계 조건: 과목당 주제 ${S.topicCount}개${S.topicCount >= 3 ? '(심화형·확장형·융합형 우선)' : ''} | 기존 소재 심화 후보: ${S.allowReuse ? '허용(발전·심화·확장 요소 명시 조건)' : '불허(기존 소재 재사용 금지)'}`);
    L.push('■ 요청 순서: ① 탐구 서사 정리(핵심 질문·반복 개념·성장 흐름·빈틈·역량 근거·사용 소재 목록) ② 발전·확장 방향 ③ 과목별 주제 카드(주제명, 설계 의도 3~4줄, 적용 학년·교과(군)·과목·구분·단원·성취기준 코드, 탐구 방법·자료, 기존 소재 여부) ④ 개요 작성할 주제 선택 요청 → 선택 시 기본 개요(탐구 배경·목적 / 주요 탐구질문 / 이론적 배경 / 본론 내용 / 배울 점과 한계점)');
    return L.join('\n');
  }

  // ---------- step 4 ----------
  function preflight() {
    const items = [];
    const st = S.student;
    items.push(st.fieldId || st.customField ? ['ok', `진로 계열: ${careerLine()}`] : ['bad', '진로 계열이 선택되지 않았습니다 (STEP 1)']);
    if (st.depts.length === 0 && st.fieldId) items.push(['wn', '희망 학과가 선택되지 않았습니다. 계열 전체 기준으로 설계됩니다.']);
    if (st.grade !== '1') { const n = S.acts.filter((a) => a.title || a.concepts).length; items.push(n || S.recordPaste.trim() ? ['ok', `기존 활동 ${n}건${S.recordPaste.trim() ? ' + 학생부 원문' : ''}`] : ['bad', '2·3학년은 기존 활동 입력이 필요합니다 (STEP 2)']); }
    else items.push(['ok', '1학년: 기존 활동 입력 생략']);
    items.push(S.selected.length ? ['ok', `적용 과목 ${S.selected.length}개 · 과목당 ${S.topicCount}개 주제`] : ['bad', '적용 과목을 선택하세요 (STEP 3)']);
    S.selected.forEach((s) => { const w = gradeWarn(BY.get(norm(s.course))); if (w) items.push(['wn', `${s.course}: ${w}`]); });
    S.acts.forEach((a) => { if (a.course && !BY.has(norm(a.course))) items.push(['wn', `기존 활동 과목 '${a.course}'은(는) 2022 개정 과목명이 아닙니다${suggest(a.course).length ? ` (후보: ${suggest(a.course).join(', ')})` : ''}.`]); });
    const icon = { ok: '✓', bad: '✗', wn: '!' };
    $('#check-box').innerHTML = `<div class="card"><div class="card-head"><h3>설계 전 점검</h3></div><div class="check-list">${items.map(([k, t]) => `<div class="${k}">${icon[k]} ${esc(t)}</div>`).join('')}</div></div>`;
    return !items.some(([k]) => k === 'bad');
  }
  function renderStep4() {
    preflight();
    setSeg($('#run-mode'), S.runMode);
    $('#mode-prompt').hidden = S.runMode !== 'prompt'; $('#mode-api').hidden = S.runMode !== 'api';
    $('#prompt-out').value = buildRequest();
    $('#api-provider').value = API.provider; $('#api-model').value = API.model || DEFAULT_MODEL[API.provider]; $('#api-key').value = API.key; $('#api-base').value = API.base;
    $('#api-base-wrap').hidden = API.provider !== 'compat';
    renderResult();
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = $('#prompt-out'); ta.focus(); ta.select();
      try { return document.execCommand('copy'); } catch (e2) { return false; }
    }
  }
  function bindStep4() {
    $('#run-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.runMode = b.dataset.v; renderStep4(); });
    $('#btn-copy').addEventListener('click', async () => { const ok = await copyText($('#prompt-out').value); $('#copy-status').textContent = ok ? '복사했습니다. 프로젝트 새 채팅에 붙여 넣으세요.' : '자동 복사가 막혔습니다. 요청문을 직접 선택해 복사하세요(전체 선택됨).'; if (!ok) { $('#prompt-out').select(); } });
    $('#btn-dl-md').addEventListener('click', () => download(`주제탐구_설계요청_${safeName()}_${fileStamp()}.md`, $('#prompt-out').value));
    $('#api-provider').addEventListener('change', (e) => { API.provider = e.target.value; API.model = DEFAULT_MODEL[API.provider]; $('#api-model').value = API.model; $('#api-base-wrap').hidden = API.provider !== 'compat'; if (API.provider === 'compat' && !API.base) { API.base = 'https://api.perplexity.ai'; $('#api-base').value = API.base; } });
    $('#api-model').addEventListener('input', (e) => { API.model = e.target.value; });
    $('#api-key').addEventListener('input', (e) => { API.key = e.target.value; });
    $('#api-base').addEventListener('input', (e) => { API.base = e.target.value; });
    $('#btn-run').addEventListener('click', runDesign);
    $('#btn-dl-result').addEventListener('click', () => download(`주제탐구_설계결과_${safeName()}_${fileStamp()}.md`, resultMarkdown()));
    $('#result').addEventListener('click', (e) => { const b = e.target.closest('[data-outline]'); if (b) runOutline(b.dataset.outline); });
  }

  // ---------- API ----------
  const SYS_RULES = `당신은 한국 고등학교 학생부종합전형 대비 주제탐구 설계 전문가다. 2022 개정 교육과정 과목·단원·성취기준에 정확히 맞춰 설계한다.
원칙:
1) 기존 활동을 서사로 정리(핵심 질문, 반복 개념·방법, 성장 흐름, 빈틈, 역량 근거[학업·진로·공동체], 사용 소재 목록). 1학년은 진로·관심사로 출발 서사를 세운다.
2) 발전·확장 방향 2~4개(심화형=같은 질문을 더 깊은 이론·정밀한 방법으로 / 확장형=다른 대상·규모·시대·지역 / 융합형=다른 교과 개념·방법 결합).
3) 과목별 주제는 지정 개수만큼, 3개 이상이면 심화형·확장형·융합형 각 1개 우선.
4) 이미 사용한 소재는 쓰지 않는다. 허용된 경우에만 reuse='기존 소재 심화 후보'로 표시하고 reuse_note에 새로워지는 요소(변수·방법·대상·규모·이론·관점)를 적는다.
5) 진로는 교과를 덮지 않고 교과 본연의 역량 위에 얹는다. 주제의 핵심 활동이 해당 과목 성취기준의 개념·기능으로 수행돼야 한다.
6) 단원 번호와 성취기준 코드는 반드시 아래 제공된 목록에서만 고른다. 목록에 없는 코드를 만들지 않는다.
7) 통계·법령·연구 결과·수치를 지어내지 않는다. 확실하지 않은 자료는 '검증 필요'라고 적고, 활용 가능한 공개 자료는 기관명 수준으로 제시한다.
8) 고교생이 학교 환경에서 수행 가능한 규모로 설계한다.`;
  function catalogFor() {
    return S.selected.map((s) => {
      const c = BY.get(norm(s.course));
      const units = c.u.filter((u) => !s.units.length || s.units.includes(u.n));
      return `### ${c.c} (${c.g} · ${c.k} · 권장 ${c.gr})${s.memo ? ' / 과목별 지시: ' + s.memo : ''}\n` + units.map((u) => `(${u.n}) ${u.m || '영역 구분 없음'}\n` + u.s.map((x) => `  [${x[0]}] ${(x[1] || '').slice(0, 110)}`).join('\n')).join('\n');
    }).join('\n\n');
  }
  function designPrompt() {
    return `${buildRequest()}\n\n## 선택 과목의 공식 단원·성취기준 목록 (이 목록에서만 매칭)\n${catalogFor()}\n\n## 출력 형식\n반드시 아래 JSON 하나만 출력한다(코드블록·설명 금지). 모든 값은 한국어.\n{"narrative":{"core_question":"","methods":"","growth":"","gaps":"","competencies":"","used_materials":[""],"summary":"한 줄 서사 요약"},"directions":[{"title":"","type":"심화형|확장형|융합형","link":"서사와의 연결","courses":["과목명"]}],"subjects":[{"course":"과목명(목록과 동일)","topics":[{"title":"주제명","type":"심화형|확장형|융합형","intent":"설계 의도 3~4문장","grade":"○학년 ○학기","unit_no":1,"unit":"단원명","standards":["코드(대괄호 없이)"],"method":"탐구 방법·활용 자료","reuse":"신규|기존 소재 심화 후보","reuse_note":""}]}]}`;
  }
  async function callLLM(system, user, wantJSON) {
    const p = API.provider; const model = (API.model || DEFAULT_MODEL[p]).trim(); const key = API.key.trim();
    if (!key) throw new Error('API 키를 입력하세요.');
    let res, data;
    if (p === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] }) });
      data = await res.json(); if (!res.ok) throw new Error(data.error && data.error.message || res.status);
      return (data.content || []).map((x) => x.text || '').join('');
    }
    if (p === 'gemini') {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: wantJSON ? { responseMimeType: 'application/json' } : {} }) });
      data = await res.json(); if (!res.ok) throw new Error(data.error && data.error.message || res.status);
      return ((data.candidates || [])[0]?.content?.parts || []).map((x) => x.text || '').join('');
    }
    const base = p === 'openai' ? 'https://api.openai.com/v1' : (API.base || '').replace(/\/+$/, '');
    if (!base) throw new Error('Base URL을 입력하세요.');
    const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    if (wantJSON && p === 'openai') body.response_format = { type: 'json_object' };
    res = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
    data = await res.json(); if (!res.ok) throw new Error(data.error && (data.error.message || data.error) || res.status);
    let text = data.choices?.[0]?.message?.content || '';
    if (Array.isArray(data.citations) && data.citations.length && !wantJSON) text += '\n\n**참고 출처**\n' + data.citations.map((u, i) => `${i + 1}. ${u}`).join('\n');
    return text;
  }
  function parseJSON(t) {
    const s = t.replace(/```json|```/g, ''); const a = s.indexOf('{'); const b = s.lastIndexOf('}');
    if (a < 0 || b < 0) throw new Error('JSON 응답을 찾지 못했습니다.');
    return JSON.parse(s.slice(a, b + 1));
  }
  async function runDesign() {
    if (!preflight()) { toast('설계 전 점검의 ✗ 항목을 먼저 채워 주세요.'); return; }
    const st = $('#api-status'); const btn = $('#btn-run');
    btn.disabled = true; st.innerHTML = '<span class="spinner"></span> 서사 정리와 과목별 주제를 생성하는 중입니다…';
    try {
      const out = await callLLM(SYS_RULES, designPrompt(), true);
      S.result = parseJSON(out); S.outlines = {};
      st.textContent = '생성 완료. 카드의 검사 표시와 사실관계를 확인하세요.';
      renderResult(); renderStepper();
    } catch (e) {
      st.textContent = '';
      $('#result').innerHTML = `<div class="callout" style="margin-top:1rem"><strong>생성에 실패했습니다.</strong><p>${esc(e.message || e)}</p><p>키·모델명을 확인하세요. 브라우저에서 직접 호출이 차단되는 제공사도 있습니다. 이 경우 '프로젝트 채팅용 요청문' 방식을 쓰세요.</p></div>`;
    } finally { btn.disabled = false; }
  }
  function validate(t, courseName) {
    const c = BY.get(norm(courseName));
    if (!c) return { c: null, course: false, unit: false, codes: (t.standards || []).map((x) => [x, false]) };
    const u = c.u.find((x) => x.n === +t.unit_no) || c.u.find((x) => x.m && t.unit && norm(x.m) === norm(t.unit));
    const all = new Map(); c.u.forEach((x) => x.s.forEach((s) => all.set(s[0], [x.n, s[1]])));
    const codes = (t.standards || []).map((x) => { const k = String(x).replace(/[\[\]]/g, '').trim(); return [k, all.has(k), all.get(k)]; });
    return { c, course: true, unit: u || null, codes };
  }
  function topicKey(ci, ti) { return `${ci}-${ti}`; }
  function renderResult() {
    const box = $('#result'); const R = S.result;
    $('#btn-dl-result').disabled = !R;
    if (!R) { box.innerHTML = ''; return; }
    const n = R.narrative || {};
    let h = `<div class="card res-sec"><h3>1. 탐구 서사 정리</h3>${n.summary ? `<div class="quote">${esc(n.summary)}</div>` : ''}
      <table class="t"><tbody>
      <tr><th>핵심 질문</th><td>${esc(n.core_question)}</td></tr><tr><th>반복 개념·방법</th><td>${esc(n.methods)}</td></tr>
      <tr><th>성장 흐름</th><td>${esc(n.growth)}</td></tr><tr><th>빈틈</th><td>${esc(n.gaps)}</td></tr>
      <tr><th>역량 근거</th><td>${esc(n.competencies)}</td></tr><tr><th>사용 소재</th><td>${(n.used_materials || []).map((x) => `<span class="kw">${esc(x)}</span>`).join('')}</td></tr>
      </tbody></table></div>`;
    h += `<div class="card res-sec"><h3>2. 발전·확장 방향</h3><table class="t"><tbody>${(R.directions || []).map((d) => `<tr><th>${esc(d.type)}</th><td><b>${esc(d.title)}</b><br>${esc(d.link)}<br><small class="hint">연결 과목: ${esc((d.courses || []).join(', '))}</small></td></tr>`).join('')}</tbody></table></div>`;
    h += `<div class="card res-sec"><h3>3. 과목별 탐구 주제</h3>`;
    (R.subjects || []).forEach((sj, ci) => {
      const c = BY.get(norm(sj.course));
      h += `<div class="course-res"><h4>${esc(sj.course)} ${c ? tagHTML(c) + `<small class="hint">${esc(c.g)} · 권장 ${esc(c.gr)}</small>` : '<span class="v bad">✗ 2022 개정 과목명 아님</span>'}</h4>`;
      (sj.topics || []).forEach((t, ti) => {
        const v = validate(t, sj.course); const k = topicKey(ci, ti);
        const unitTxt = v.unit ? `<span class="v ok">✓ 단원</span>(${v.unit.n}) ${esc(v.unit.m || '영역 구분 없음')}` : `<span class="v bad">✗ 단원 불일치</span>${esc(t.unit_no ? '(' + t.unit_no + ') ' : '')}${esc(t.unit || '')}`;
        const codeTxt = v.codes.length ? v.codes.map(([cd, ok, info]) => ok ? `<span class="v ok" title="${esc(info[1])}">✓ ${esc(cd)}</span>${v.unit && info[0] !== v.unit.n ? '<span class="v wn">다른 단원 코드</span>' : ''}` : `<span class="v bad">✗ ${esc(cd)}</span>`).join('') : '<span class="v wn">코드 없음</span>';
        const stdText = v.codes.filter((x) => x[1]).map(([cd, , info]) => `<div class="hint">[${esc(cd)}] ${esc(info[1])}</div>`).join('');
        const reuse = t.reuse && t.reuse.includes('심화') ? `<span class="v wn">기존 소재 심화 후보</span> ${esc(t.reuse_note || '')}` : '<span class="v ok">신규 소재</span>';
        h += `<article class="topic"><div class="topic-h"><h5>주제 ${ti + 1}. ${esc(t.title)}</h5><span class="tag cat-${t.type === '심화형' ? '일반' : t.type === '확장형' ? '진로' : '융합'}">${esc(t.type || '')}</span></div>
          <dl><dt>설계 의도</dt><dd>${esc(t.intent)}</dd>
          <dt>적용</dt><dd>${esc(t.grade || '')} · ${c ? esc(c.g) + ' · ' + esc(c.c) + '(' + esc(c.k) + ')' : esc(sj.course)}<br>${unitTxt}<br>${codeTxt}${stdText}</dd>
          <dt>방법·자료</dt><dd>${esc(t.method)}</dd><dt>소재</dt><dd>${reuse}</dd></dl>
          <div class="out-actions" style="margin:.75rem 0 0"><button type="button" class="btn btn-sm btn-secondary" data-outline="${k}">${S.outlines[k] ? '개요 다시 작성' : '기본 개요 작성'}</button><span class="status" id="os-${k}"></span></div>
          ${S.outlines[k] ? `<div class="outline">${DOMPurify.sanitize(marked.parse(S.outlines[k]))}</div>` : ''}</article>`;
      });
      h += `</div>`;
    });
    h += `</div>`;
    box.innerHTML = h;
  }
  async function runOutline(k) {
    const [ci, ti] = k.split('-').map(Number); const sj = S.result.subjects[ci]; const t = sj.topics[ti];
    const st = $('#os-' + k); st.innerHTML = '<span class="spinner"></span> 개요 작성 중…';
    const v = validate(t, sj.course);
    const std = v.codes.filter((x) => x[1]).map(([cd, , i]) => `[${cd}] ${i[1]}`).join('\n');
    const prompt = `다음 탐구 주제의 기본 개요를 마크다운으로 작성하라.\n\n학생 서사 요약: ${S.result.narrative?.summary || ''}\n사용 소재(재사용 금지): ${(S.result.narrative?.used_materials || []).join(', ')}\n주제: ${t.title} (${t.type})\n설계 의도: ${t.intent}\n과목: ${sj.course} / 단원: ${v.unit ? `(${v.unit.n}) ${v.unit.m || '영역 구분 없음'}` : t.unit}\n성취기준:\n${std}\n탐구 규칙: ${S.rules || '없음'}\n\n형식(머리글 그대로):\n## ${t.title} 기본 개요\n### 1. 탐구 배경 및 목적\n### 2. 주요 탐구질문 (3개 내외)\n### 3. 이론적 배경 (개념·이론 2~4개: 정의 + 탐구에 쓰는 방식, 확실하지 않으면 '검증 필요')\n### 4. 본론 내용 (단계 | 내용 | 방법·자료 | 산출물 표, 생각이 바뀔 수 있는 검증 지점 포함)\n### 5. 배울 점과 한계점 (배울 점, 한계점, 후속 탐구 연결)\n수치·통계·법령을 지어내지 말 것. 세특 기재 문장은 쓰지 말 것.`;
    try {
      S.outlines[k] = await callLLM(SYS_RULES, prompt, false);
      renderResult();
    } catch (e) { st.textContent = '실패: ' + (e.message || e); }
  }
  function resultMarkdown() {
    const R = S.result; if (!R) return '';
    const n = R.narrative || {}; const L = [`# 주제탐구 설계 결과 — ${S.student.name || '학생'}`, '', `- 진로: ${careerLine()} / ${S.student.depts.join(', ')}`, `- 적용 시기: ${S.student.apply[0]}학년 ${S.student.apply[2]}학기`, `- 생성: AI API(${API.provider}, ${API.model || DEFAULT_MODEL[API.provider]}) · 과목·단원·코드는 앱 내장 DB로 검사, 사실관계는 별도 확인 필요`, '', '## 1. 탐구 서사 정리', `> ${n.summary || ''}`, '', '| 칸 | 정리 |', '|---|---|', `| 핵심 질문 | ${n.core_question || ''} |`, `| 반복 개념·방법 | ${n.methods || ''} |`, `| 성장 흐름 | ${n.growth || ''} |`, `| 빈틈 | ${n.gaps || ''} |`, `| 역량 근거 | ${n.competencies || ''} |`, `| 사용 소재 | ${(n.used_materials || []).join(', ')} |`, '', '## 2. 발전·확장 방향', '| 유형 | 방향 | 서사와의 연결 | 연결 과목 |', '|---|---|---|---|', ...(R.directions || []).map((d) => `| ${d.type} | ${d.title} | ${d.link} | ${(d.courses || []).join(', ')} |`), '', '## 3. 과목별 탐구 주제'];
    (R.subjects || []).forEach((sj, ci) => {
      const c = BY.get(norm(sj.course)); L.push('', `### ${sj.course}${c ? ` (${c.g} · ${c.k} · 권장 ${c.gr})` : ' (2022 개정 과목명 확인 필요)'}`);
      (sj.topics || []).forEach((t, ti) => {
        const v = validate(t, sj.course);
        L.push('', `#### 주제 ${ti + 1}. ${t.title} — ${t.type || ''}`, `- 설계 의도: ${t.intent}`, `- 적용: ${t.grade || ''} | ${sj.course} | 단원 ${v.unit ? `(${v.unit.n}) ${v.unit.m || '영역 구분 없음'}` : `${t.unit || ''} [단원 확인 필요]`} | 성취기준 ${v.codes.map(([cd, ok]) => `[${cd}]${ok ? '' : '(확인 필요)'}`).join(' ')}`, `- 탐구 방법·자료: ${t.method}`, `- 소재: ${t.reuse || '신규'}${t.reuse_note ? ' — ' + t.reuse_note : ''}`);
        const o = S.outlines[topicKey(ci, ti)]; if (o) L.push('', o);
      });
    });
    return L.join('\n');
  }

  // ---------- summary ----------
  function renderSummary() {
    const st = S.student; const f = field();
    const rows = [
      ['학생', st.name || '<span class="muted">미기재</span>'],
      ['학년 · 적용 시기', `${st.grade}학년 · ${st.apply[0]}학년 ${st.apply[2]}학기`],
      ['진로 계열', f ? esc(`${f.id} ${f.name}`) : st.customField ? esc(st.customField) : '<span class="muted">미선택</span>'],
      ['희망 학과', st.depts.length ? esc(st.depts.join(', ')) : '<span class="muted">미선택</span>'],
      ['기존 활동', st.grade === '1' ? '1학년 · 생략' : `${S.acts.filter((a) => a.title || a.concepts).length}건${S.recordPaste.trim() ? ' + 원문' : ''}`],
      ['적용 과목', S.selected.length ? S.selected.map((s) => esc(s.course)).join(', ') : '<span class="muted">미선택</span>'],
      ['과목당 주제 수', `${S.topicCount}개`],
    ];
    $('#summary').innerHTML = rows.map(([k, v]) => `<div class="sum-row"><span>${k}</span><div>${v}</div></div>`).join('');
  }

  // ---------- save / load ----------
  function exportJSON() {
    const data = { app: 'inquiry-studio', version: 1, savedAt: new Date().toISOString(), state: S };
    download(`주제탐구_입력_${safeName()}_${fileStamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('입력 내용을 JSON 파일로 저장했습니다.');
  }
  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result); const st = d.state || d;
        S = Object.assign(blank(), st); S.student = Object.assign(blank().student, st.student || {});
        fillStep1(); renderSummary(); go(1); toast('입력 내용을 불러왔습니다.');
      } catch (e) { toast('불러오기 실패: 올바른 JSON 파일이 아닙니다.'); }
    };
    r.readAsText(file);
  }
  function loadSample() {
    S = blank();
    Object.assign(S.student, { name: '예시 학생(2학년)', grade: '2', apply: '2-2', fieldId: '18', depts: ['행정학과', '공공정책학과'], career: '지역 간 공공서비스 격차를 줄이는 정책을 설계하는 지방행정 전문가', interest: '지역 소멸, 공공데이터, 교통 접근성 / 피하고 싶은 소재: 출산율 단순 조사', school: '일반고, 엑셀·구글 시트 사용 가능, 정보 과목 파이썬 기초 이수' });
    if (!F.find((f) => f.id === '18')) S.student.fieldId = F[0] ? F[0].id : '';
    const f = field(); if (f) S.student.depts = f.departments.slice(0, 2);
    S.acts = [
      { id: uid(), grade: '1', area: '교과 세특', course: '통합사회1', title: '우리 시 버스 노선 개편 전후 읍·면 지역 이동권 변화 조사', concepts: '공간 불평등, 접근성, 지자체 교통 정책 보도자료', result: '외곽 지역 배차 간격 증가로 고령층 이동 불편이 커졌다고 판단', questions: '이동권을 수치로 측정하는 방법을 몰라 사례 중심에 그침' },
      { id: uid(), grade: '1', area: '교과 세특', course: '공통수학2', title: '집합과 명제로 정책 대상자 선정 기준 분석하기', concepts: '집합 연산, 필요충분조건, 기초연금 수급 요건', result: '조건 설계에 따라 사각지대가 생길 수 있음을 확인', questions: '실제 사각지대 규모는 확인하지 못함' },
      { id: uid(), grade: '1', area: '진로활동', course: '', title: '시청 민원 처리 과정 직업 탐색', concepts: '행정 절차, 민원 데이터 공개', result: '데이터 기반 행정에 관심', questions: '' },
      { id: uid(), grade: '2', area: '교과 세특', course: '사회와 문화', title: '농촌 고령층 디지털 격차 설문 결과 분석', concepts: '사회 불평등, 질문지법, 표본 편향', result: '연령보다 교육 수준이 디지털 활용도와 더 밀접하다고 해석', questions: '표본 30명으로 일반화 한계' },
    ];
    S.selected = [{ course: '확률과 통계', units: [], memo: '수행평가 보고서(통계적 추정 활용 권장)' }, { course: '정치', units: [], memo: '' }, { course: '영어 독해와 작문', units: [], memo: '영어 지문 분석 중심' }];
    S.rules = '보고서 A4 3쪽 이내, 수업 단원과 연계, 학교에서 2주 내 수행 가능한 규모';
    fillStep1(); renderSummary(); go(1); toast('예시 학생을 불러왔습니다. 단계를 넘기며 확인해 보세요.');
  }

  // ---------- init ----------
  function init() {
    const dl = document.createElement('datalist'); dl.id = 'course-dl'; dl.innerHTML = C.map((c) => `<option value="${esc(c.c)}">`).join(''); document.body.appendChild(dl);
    bindStep1(); bindStep2(); bindStep3(); bindStep4();
    document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(+b.dataset.go); });
    $('#btn-export').addEventListener('click', exportJSON);
    $('#file-import').addEventListener('change', (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; });
    $('#btn-sample').addEventListener('click', loadSample);
    const rb = $('#btn-reset');
    rb.addEventListener('click', () => {
      if (!rb.dataset.arm) { rb.dataset.arm = '1'; rb.textContent = '한 번 더 누르면 초기화'; clearTimeout(rb._t); rb._t = setTimeout(() => { delete rb.dataset.arm; rb.textContent = '새로 시작'; }, 3000); return; }
      delete rb.dataset.arm; rb.textContent = '새로 시작';
      S = blank(); fillStep1(); renderSummary(); go(1); toast('새 학생 입력을 시작합니다.');
    });
    fillStep1(); renderSummary(); go(1);
  }
  init();
})();
