import { UserFacingError } from '../utils/errors.js'

const usageError = () => new UserFacingError('Use a numeric expression with +, -, *, /, %, ^, and parentheses.')
const malformedError = () => new UserFacingError('Malformed expression.')

function tokenize(source) {
  const tokens = []
  const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([()+\-*/%^]))/y
  let position = 0

  while (position < source.length) {
    pattern.lastIndex = position
    const match = pattern.exec(source)
    if (!match) throw usageError()
    tokens.push(match[1] ?? match[2])
    position = pattern.lastIndex
  }

  return tokens
}

export function calculate(expression) {
  const source = String(expression ?? '').trim()
  if (!source || source.length > 200) throw usageError()

  const tokens = tokenize(source)
  let position = 0

  function parseAdditive() {
    let value = parseMultiplicative()
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++]
      const right = parseMultiplicative()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  function parseMultiplicative() {
    let value = parseUnary()
    while (tokens[position] === '*' || tokens[position] === '/' || tokens[position] === '%') {
      const operator = tokens[position++]
      const right = parseUnary()
      if ((operator === '/' || operator === '%') && right === 0) {
        throw new UserFacingError(operator === '/' ? 'Division by zero is not allowed.' : 'Modulo by zero is not allowed.')
      }
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right
    }
    return value
  }

  function parseUnary() {
    if (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++]
      const value = parseUnary()
      return operator === '-' ? -value : value
    }
    return parsePower()
  }

  function parsePower() {
    let value = parsePrimary()
    if (tokens[position] === '^') {
      position += 1
      value **= parseUnary()
    }
    return value
  }

  function parsePrimary() {
    const token = tokens[position]
    if (token === undefined) throw malformedError()

    if (/^(?:\d|\.)/.test(token)) {
      position += 1
      return Number(token)
    }

    if (token === '(') {
      position += 1
      const value = parseAdditive()
      if (tokens[position] !== ')') throw new UserFacingError('Unbalanced parentheses.')
      position += 1
      return value
    }

    throw malformedError()
  }

  const result = parseAdditive()
  if (position !== tokens.length) {
    if (tokens[position] === ')') throw new UserFacingError('Unbalanced parentheses.')
    throw malformedError()
  }
  if (!Number.isFinite(result)) throw new UserFacingError('Result is not finite.')
  return Number(result.toFixed(12))
}
