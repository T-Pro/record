
/**
 * Great common divisor
 */
export function gcd(a: number, b: number): number {
  if (!b){
    return a;
  }
  return gcd(b, a % b);
}

function dotProduct(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; ++i){
    s += a[i] * b[i];
  }
  return s;
}

/**
 * Reduces the denominator and numerator of a fraction by dividing
 * it by its greatest common divisor
 * @param p numerator
 * @param q denominator
 */
export function minimalFraction(p: number, q: number): [number, number]{
  const d = gcd(p, q);
  return [p / d, q / d];
}

/**
 * ## Description
 *
 * Given f1, fc, f3
 *
 * Helper function to choose a good pair of Farrow structures
 * that resamples from f1 to fc' and from fc' to f2
 * having $|fc'/fc - 1| < r_{tol}$
 *
 * this function returns [p1, q1, p2, q2] for the interpolator
 * step sizes $s1 = p1 / q1$, and $s2 = p2 / q2$.
 * satisfying the requirements.
 *
 * ## What makes a good Farrow structure?
 *
 * If the $s = p / q$,
 * then `k * s = floor(k * p / q) + (k * p % q) / q`
 * A Farrow structure precomputes coefficients for the interpolators
 * for each values of p % q.
 *
 * Assuming $gcd(p, q) = 1$, a farrow filter will precompute and use
 * $q$ distinct vectors.
 *
 * ## Problem formulation
 *
 * We need two interpolators with steps s1 * s2 = f1 / f2
 * let s1 = p1 / q1, and s2 = p2 / q2
 *
 * and we need s1 = fc' / f1
 *
 * thus p1 / q1 * p2 / q2 = f1 / f2
 *
 * so this can be equivalent to into a standard problem
 * adjusting the center frequency
 *
 */
export function getFarrowStructurePair(
  f1: number, fc: number, f2: number, rTol: number
): [[number, number], [number, number]] | undefined {
  let p1: number;
  let p2: number;
  let q1: number;
  let q2: number;
  let ans: [[number, number], [number, number]] | undefined;
  let score = Infinity;
  const fcl = fc * (1 - rTol) / f1;
  const fcr = fc * (1 + rTol) / f1;
  for (q1 = 1; q1 < score; ++q1){
    for (p1 = Math.ceil(fcl * q1); p1 <= fcr * q1; ++p1){
      [p2, q2] = minimalFraction(f1 * q1, f2 * p1);
      if (q1 + q2 < score){
        score = q1 + q2;
        ans = [[p1, q1], [p2, q2]];
      }
    }
  }
  return ans;
}

/**
 * Finds a fraction representation for a number
 *
 * @param s a number to be approximated
 * @param r relative error tolerance
 * @param maxDenominator the maximum acceptable denominator
 */
export function toFraction(s: number, r: number = 1e-3, maxDenominator: number = 1000): [number, number] {
  if (s < 0) {
    const [p, q] = toFraction(-s, r, maxDenominator);
    return [-p, q];
  } else if (s > 1) {
    const [p, q] = toFraction(1 / s, r, maxDenominator);
    return [q, p];
  } else {
    let pL = 0;
    let qL = 1;
    let pR = 1;
    let qR = 0;
    let pM = 1;
    let qM = 1;
    let pBest = 0;
    let qBest = 0;
    let rBest = Infinity;
    while (qM < maxDenominator && rBest > r) {
      const rM = Math.abs(1 - s * qM / pM);
      if (rM < r || rM < rBest) {
        pBest = pM;
        qBest = qM;
        rBest = rM;
      }
      if (s * qM < pM) {
        pR = pM;
        qR = qM;
      } else {
        pL = pM;
        qL = qM;
      }
      pM = pL + pR;
      qM = qL + qR;
    }
    return [pBest, qBest];
  }
}
