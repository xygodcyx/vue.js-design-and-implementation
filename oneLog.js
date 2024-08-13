;(function () {
  window = typeof window === 'undefined' ? {} : window
  const scopeMap = (window.scopeMap = new Map())

  function getPathSeparator() {
    if (typeof document !== 'undefined') {
      return '/'
    } else if (typeof process !== 'undefined' && process.platform) {
      return process.platform === 'win32' ? '\\' : '/'
    } else if (typeof navigator !== 'undefined') {
      return navigator.platform.indexOf('Win') === 0 ? '\\' : '/'
    } else {
      throw new Error('无法确定运行环境')
    }
  }

  function trackScope(error) {
    const info = error.stack.split('\n')[3]
    const functionName = info.trim().split(' ')[1] //函数名
    const scope = info.split('\n')[2] //文件位置
    const temp = info.split('(')[1].split(getPathSeparator()).pop().split(':')
    const rowAndColumn = temp[1] + ':' + temp[2].substring(temp[2].length - 3, temp[2].length - 1) //行列号
    return [functionName, scope, rowAndColumn]
  }
  const originalConsoleLog = console.log
  window._log = new Proxy(originalConsoleLog, {
    apply(target, thisArg, argumentsList) {
      const error = new Error()
      const stackTrace = trackScope(error)
      const currentScope = error.stack.split('\n')[2]
      if (!scopeMap.has(currentScope)) {
        scopeMap.set(currentScope, true)
        let args = argumentsList.slice()
        args = args.map((item) => {
          if (typeof item === 'object') {
            try {
              item = JSON.parse(JSON.stringify(item))
              return item
            } catch (e) {
              console.log(e)
            }
          }
          return item
        })
        const track = [
          '%c' + stackTrace[0] + ':' + stackTrace[2],
          'color: #007acc; font-weight: bold; font-size: 14px;',
          ...args,
        ]
        return Reflect.apply(target, thisArg, track)
      }
    },
  })
})()
function log(...args) {
  return window._log(...args)
}
const obj = { a: 12 }
// 使用示例
function exampleFunction() {
  for (let i = 0; i < 10; i++) {
    log('hello world', '121', obj)
  }
}
exampleFunction()
obj.a = 121

console.log(obj) // { a: 121 }
