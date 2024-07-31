interface Invoker {
  value: Function | Function[]
  (e: Event): void
}

const invokers: { [key: string]: Invoker } = {}

function createInvoker(eName: string, nextValue: Function | Function[]): Invoker {
  const invoker: Invoker = function (e: Event) {
    if (Array.isArray(invoker.value)) {
      invoker.value.forEach((fn) => fn(e))
    } else {
      invoker.value(e)
    }
  }

  invoker.value = nextValue
  invokers[eName] = invoker
  return invoker
}

// 示例使用
const nextValue = [(e: Event) => console.log('Event 1', e), (e: Event) => console.log('Event 2', e)]

const invoker = createInvoker('exampleEvent', nextValue)
// invoker({ type: 'example' }) // 这将触发事件处理函数
