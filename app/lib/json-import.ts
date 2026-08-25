function balancedJsonObject(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace === -1) throw new Error('لم أجد كائن JSON في النتيجة. انسخ رد ChatGPT كاملًا ثم حاول مجددًا.');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return cleaned.slice(firstBrace, index + 1);
    }
  }

  throw new Error('يبدو أن رد ChatGPT انقطع قبل اكتمال JSON. اطلب منه متابعة JSON من موضع التوقف أو إعادة الجزء الأخير فقط.');
}

function repairBackslashesAndControls(value: string) {
  let output = '';
  let inString = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      let slashCount = 0;
      for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashCount += 1;
      if (slashCount % 2 === 0) inString = !inString;
      output += char;
      continue;
    }
    if (!inString) {
      output += char;
      continue;
    }
    if (char === '\r' || char === '\n') {
      output += char === '\r' && value[index + 1] === '\n' ? '\\n' : '\\n';
      if (char === '\r' && value[index + 1] === '\n') index += 1;
      continue;
    }
    if (char !== '\\') {
      output += char;
      continue;
    }

    const next = value[index + 1] || '';
    if (next === '\\') {
      output += '\\\\';
      index += 1;
      continue;
    }
    if (next === '"' || next === '/') {
      output += `\\${next}`;
      index += 1;
      continue;
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(value.slice(index + 2, index + 6))) {
      output += value.slice(index, index + 6);
      index += 5;
      continue;
    }

    const command = value.slice(index + 1).match(/^[A-Za-z]+/)?.[0] || '';
    const standardEscape = command.length === 1 && 'bfnrt'.includes(command);
    if (standardEscape) output += `\\${next}`;
    else output += '\\\\';
  }
  return output;
}

function removeTrailingCommas(value: string) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ',') {
      let cursor = index + 1;
      while (/\s/.test(value[cursor] || '')) cursor += 1;
      if (value[cursor] === '}' || value[cursor] === ']') continue;
    }
    output += char;
  }
  return output;
}

export function prepareJsonImport(value: string) {
  const object = balancedJsonObject(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  return removeTrailingCommas(repairBackslashesAndControls(object));
}
