const authenticationFailure = value => /(?:JWT|cookie|token|credential|凭据|登录|登陆).{0,60}(?:过期|失效|expired|invalid|unauthori[sz]ed)|(?:过期|expired).{0,40}(?:JWT|token|cookie)|\b(?:401|403)\b/i.test(String(value || ''));
function assertDataCredentials(data) {
  const evidence = [...(data.issues || []).map(issue => `${issue.code || ''} ${issue.message || ''}`), data.head?.revenue_message, data.head?.revenue_error].filter(Boolean);
  if (evidence.some(authenticationFailure)) {
    const error = new Error('凭据校验未通过：暂停取数和草稿生成，请用户续期登录凭据后重新获取。旧数据包中的失效标记也需重新核验；禁止用空榜、0值或旧包绕过。');
    error.code = 'CREDENTIALS_REQUIRED'; error.exitCode = 3; throw error;
  }
}
const end14 = release => { const date = new Date(`${release}T00:00:00Z`); if (!Number.isFinite(date.valueOf())) return null; date.setUTCDate(date.getUTCDate() + 13); return date.toISOString().slice(0,10); };
function historicalEvidence(metric, month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return false;
  const [year, number] = month.split('-').map(Number), end = new Date(Date.UTC(year,number,0)).toISOString().slice(0,10);
  if (metric?.snapshot_date === end || metric?.as_of_date === end) return true;
  return metric?.window?.start === `${month}-01` && metric.window.end === end && ['UTC+8','Asia/Shanghai','+08:00'].includes(metric.window.timezone);
}
function prepareMonthlyData(original) {
  assertDataCredentials(original);
  const data = structuredClone(original), blocked = [];
  const reject = (path, reason, expected, actual) => blocked.push({ path, reason, expected, actual });
  const currentReviews = (data.issues || []).some(issue => issue.code === 'reviews_are_current_snapshot');
  const unverifiedReviews = currentReviews || ['review_rate_all','review_rate_sc','rated_game'].some(key => data.kpis?.[key] && !historicalEvidence(data.kpis[key],data.report_month));
  if (unverifiedReviews) {
    for (const key of ['review_rate_all','review_rate_sc','rated_game']) if (data.kpis?.[key]) {
      reject(`kpis.${key}`, currentReviews ? '当前快照不能代表报告月历史评测或月末定级状态' : '缺少匹配报告月的历史评测窗口证据', data.report_month, data.data_cutoff);
      data.kpis[key] = { ...data.kpis[key], value: null, rate: null, total: null, positive: null, status: 'unavailable' };
    }
    for (const key of ['rated_game_count','rated_game_rate']) if (data.metric_contracts?.[key]) {
      reject(`metric_contracts.${key}`, '依赖当前累计评测，不是月末历史状态', data.report_month, data.data_cutoff);
      data.metric_contracts[key] = { ...data.metric_contracts[key], value: null, numerator: null, status: 'unavailable' };
    }
    if (data.market) {
      reject('market.review_trend', '各月份新品群体的当前好评率不能替代历史月份好评率', data.report_month, data.data_cutoff);
      reject('market.review_distribution', '当前评测分布不符合历史窗口，且须另核对定级产品分母', data.report_month, data.data_cutoff);
      data.market.review_trend = (data.market.review_trend || []).map(item => ({ ...item, review_rate_all: null, review_rate_sc: null }));
      data.market.review_distribution = [];
    }
  } else if (data.market) {
    data.market.review_trend = (data.market.review_trend || []).map(item => {
      if (historicalEvidence(item,item.month)) return item;
      reject(`market.review_trend.${item.month}`, '缺少该月份历史窗口证据', item.month, item.snapshot_date || null);
      return { ...item, review_rate_all: null, review_rate_sc: null };
    });
    if ((data.market.review_distribution || []).some(item => !historicalEvidence(item,data.report_month))) {
      reject('market.review_distribution', '缺少历史分布窗口证据',data.report_month,null);
      data.market.review_distribution = [];
    }
  }
  for (const [tier, games] of Object.entries(data.new_releases || {})) {
    if (!Array.isArray(games)) continue;
    for (const game of games) {
      const expected = { start: game.release_date, end: end14(game.release_date) };
      for (const [name, metric] of Object.entries(game.day14?.metrics || {})) {
        if (!metric || metric.status !== 'ok') continue;
        const window = metric.window;
        if (!expected.end || window?.start !== expected.start || window?.end !== expected.end || !['UTC+8','Asia/Shanghai','+08:00'].includes(window?.timezone) || !Array.isArray(window?.missing_dates) || window.missing_dates.length) {
          reject(`new_releases.${tier}.${game.appid}.day14.${name}`, '上线14日窗口或时区不匹配，或缺少完整日期证据', expected, window || null);
          metric.value = null; metric.display_value = null; metric.status = 'unavailable';
        }
      }
      if (game.reviews_14d?.status === 'ok' && game.reviews_14d.snapshot_date !== expected.end) {
        reject(`new_releases.${tier}.${game.appid}.reviews_14d`, '评测快照不是上线第14日', expected.end, game.reviews_14d.snapshot_date || null);
        game.reviews_14d = { ...game.reviews_14d, value: null, positive_rate: null, status: 'unavailable' };
      }
    }
  }
  for (const field of ['month','previous_month']) {
    if (!data.head?.[field]) continue;
    const date = new Date(`${data.report_month}-01T00:00:00Z`); if (field === 'previous_month') date.setUTCMonth(date.getUTCMonth()-1);
    const expected = date.toISOString().slice(0,7);
    if (data.head[field] !== expected) {
      const error = new Error(`头部榜${field}时间窗口不匹配：需要${expected}，实际${data.head[field]}`);
      error.code = 'TIME_WINDOW_MISMATCH'; throw error;
    }
  }
  data.issues = [...(data.issues || []), ...blocked.map(item => ({ code: 'temporal_data_excluded', message: `${item.path}：${item.reason}`, ...item }))];
  return { data, blocked };
}
module.exports = { assertDataCredentials, prepareMonthlyData, authenticationFailure };
