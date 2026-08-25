import {
  Math as DocxMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
  type MathComponent,
} from 'docx';

const SYMBOLS: Record<string, string> = {
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡',
  angle: '∠', measuredangle: '∡', triangle: '△', square: '□', parallel: '∥', perp: '⟂',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', emptyset: '∅', infty: '∞', therefore: '∴', because: '∵',
  rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  overrightarrow: '→', overleftarrow: '←', degree: '°', circ: '°', prime: '′',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ',
  mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', phi: 'φ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc', log: 'log', ln: 'ln',
  max: 'max', min: 'min', lim: 'lim', sum: '∑', int: '∫', prod: '∏',
  ldots: '…', cdots: '⋯', dots: '…', quad: '  ', qquad: '    ', textbackslash: '\\',
};

class LatexParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(stop?: string): MathComponent[] {
    const output: MathComponent[] = [];
    while (this.index < this.source.length) {
      if (stop && this.source[this.index] === stop) {
        this.index += 1;
        break;
      }
      if (/\s/.test(this.source[this.index])) {
        this.index += 1;
        if (output.length > 0) output.push(new MathRun(' '));
        continue;
      }
      const base = this.parseAtom();
      if (base.length === 0) continue;
      let subScript: MathComponent[] | undefined;
      let superScript: MathComponent[] | undefined;
      while (this.source[this.index] === '_' || this.source[this.index] === '^') {
        const marker = this.source[this.index];
        this.index += 1;
        const script = this.parseScript();
        if (marker === '_') subScript = script;
        else superScript = script;
      }
      if (subScript && superScript) output.push(new MathSubSuperScript({ children: base, subScript, superScript }));
      else if (subScript) output.push(new MathSubScript({ children: base, subScript }));
      else if (superScript) output.push(new MathSuperScript({ children: base, superScript }));
      else output.push(...base);
    }
    return output;
  }

  private parseScript() {
    if (this.source[this.index] === '{') {
      this.index += 1;
      return this.parse('}');
    }
    return this.parseAtom();
  }

  private parseGroup() {
    while (/\s/.test(this.source[this.index] || '')) this.index += 1;
    if (this.source[this.index] !== '{') return this.parseAtom();
    this.index += 1;
    return this.parse('}');
  }

  private readCommand() {
    this.index += 1;
    if (this.index >= this.source.length) return '';
    if (!/[A-Za-z]/.test(this.source[this.index])) return this.source[this.index++];
    const start = this.index;
    while (/[A-Za-z]/.test(this.source[this.index] || '')) this.index += 1;
    return this.source.slice(start, this.index);
  }

  private groupText(components: MathComponent[]) {
    return components.length > 0 ? components : [new MathRun('')];
  }

  private parseAtom(): MathComponent[] {
    const char = this.source[this.index];
    if (!char) return [];
    if (char === '{') {
      this.index += 1;
      return this.parse('}');
    }
    if (char === '}') {
      this.index += 1;
      return [];
    }
    if (char !== '\\') {
      this.index += 1;
      return [new MathRun(char)];
    }

    const command = this.readCommand();
    if (command === 'frac' || command === 'dfrac' || command === 'tfrac') {
      return [new MathFraction({ numerator: this.groupText(this.parseGroup()), denominator: this.groupText(this.parseGroup()) })];
    }
    if (command === 'sqrt') {
      let degree: MathComponent[] | undefined;
      if (this.source[this.index] === '[') {
        this.index += 1;
        const start = this.index;
        while (this.index < this.source.length && this.source[this.index] !== ']') this.index += 1;
        degree = [new MathRun(this.source.slice(start, this.index))];
        if (this.source[this.index] === ']') this.index += 1;
      }
      return [new MathRadical({ children: this.groupText(this.parseGroup()), degree })];
    }
    if (command === 'text' || command === 'textrm' || command === 'mathrm' || command === 'mathbf' || command === 'operatorname') {
      return this.parseGroup();
    }
    if (command === 'left' || command === 'right' || command === ',') return [];
    if (command === 'overline' || command === 'bar' || command === 'vec' || command === 'hat' || command === 'widehat') {
      const content = this.parseGroup();
      const prefix = command === 'vec' ? '→' : command === 'hat' || command === 'widehat' ? '^' : '¯';
      return [new MathRun(prefix), ...content];
    }
    if (command === '\\') return [new MathRun(' ')];
    return [new MathRun(SYMBOLS[command] ?? (command ? command : '\\'))];
  }
}

export function latexToDocxMath(latex: string) {
  const parser = new LatexParser(latex.trim());
  const children = parser.parse();
  return new DocxMath({ children: children.length > 0 ? children : [new MathRun(latex)] });
}
