function predictCategory(text = '') {
  const d = (text || '').toLowerCase();
  if (!d) return { department_id: 3, priority: 'MEDIUM', confidence: 0.4 };
  if (/\b(pipe|leak|water|tap|burst)\b/.test(d)) return { department_id:1, priority:'HIGH', confidence:0.92 };
  if (/\b(garbage|waste|sewage|dump|overflow)\b/.test(d)) return { department_id:2, priority:'HIGH', confidence:0.92 };
  if (/\b(light|electric|power|electricity|cable)\b/.test(d)) return { department_id:4, priority:'HIGH', confidence:0.9 };
  if (/\b(road|pothole|potholes|pavement|sidewalk|drain)\b/.test(d)) return { department_id:3, priority:'MEDIUM', confidence:0.9 };
  return { department_id:3, priority:'MEDIUM', confidence:0.5 };
}

module.exports = { predictCategory };
