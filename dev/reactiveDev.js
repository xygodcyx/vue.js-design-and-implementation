'use strict'

// {}型对象的 for...in/of 的依赖收集 唯一键名
let ITERATE_KEY = Symbol() //Returns a new unique Symbol value.
// 对map.keys的依赖收集 唯一键名
let MAP_KEY_ITERATE_KEY = Symbol() //Returns a new unique Symbol value.
// 可以通过这个key找到响应式数据的原始数据,因为是全局唯一,所以不可能重复
let RAW_KEY = Symbol() //Returns a new unique Symbol value.

// 为了解决类似于数组includes方法查找非原始值会将两个不同的代理对象(或一个代理对象一个原始值,比如直接在includes里传入非原始值{a:1}而不是通过响应式数据的索引)
// 进行比较,而这就导致了和预期不同的结果(明明键值对完全一样,但是不相等--new proxy的原因,既然new proxy无法改变,那么就
// 用一个"缓存"来把之前已经代理过的对象存起来,然后取的时候直接从"缓存"里取就行了 reactiveMap
const reactiveMap = new Map()
// 这是为了重写数组的includes方法,让arr2.includes({a:1})也可以被正确查找
// 思路就是在proxy拦截get的时候,判断当前操作数组的key(arr.includes)在不在这个我们覆写的对象上,在就返回我们覆写的这个对象
// 这种方法的可行性的依据是数组在读取原型方法时,实际上是读取了属性(includes,indexOf...),于是我们可以进行拦截这些(key)
// 然后返回我们自己定义的includes方法,这样就实现了数组的includes方法的覆写
let shouldTrack = true
// *数组的方法重写
const arrayInstrumentations = {}
;['includes', 'indexOf', 'lastIndexOf', 'findIndex', 'find'].forEach((method) => {
  const originalMethod = Array.prototype[method]
  // 其中this是代理数组,因为我们用Reflect.get将this改变为代理对象(receiver,即实际调用对象而不是原始对象)
  arrayInstrumentations[method] = function (...args) {
    let res = originalMethod.apply(this, args)
    // 如果没有找到,说明传来的参数不是代理对象而是一个原始值,所有我们需要获取代理对象的原始值(data.RAW_KEY)
    if (res === false || res === -1 || res === undefined) {
      res = originalMethod.apply(this.RAW_KEY, args)
    }
    return res
  }
})
;['push', 'pop', 'shift', 'unshift', 'splice'].forEach((method) => {
  const originalMethod = Array.prototype[method]
  arrayInstrumentations[method] = function (...args) {
    shouldTrack = false
    let res = originalMethod.apply(this, args)
    shouldTrack = true
    return res
  }
})
// *set和map的方法重写
const mutableInstrumentations = {
  // set
  add(value) {
    const target = this[RAW_KEY]
    const hasKey = target.has(value)
    // 和map类似,要避免数据污染就要将准备传入的响应式数据转换为原始值
    // 数据污染:将响应式数据赋值给原始数据的行为
    const rawValue = value[RAW_KEY] || value
    let res = target.add(rawValue)
    if (!hasKey) {
      // 这里依然要写key,不能写ITERATE_KEY,因为这是专注于触发一个属性的副作用函数,并且类型要写上
      // 因为我们之前在写普通对象时,处理了ADD和DELETE的情况,这里可以复用
      trigger(target, value, 'ADD')
    }
    return res
  },
  delete(value) {
    const target = this[RAW_KEY]
    const hadKey = target.has(value)
    let res = target.delete(value)
    if (hadKey) {
      // 这里依然要写key,不能写ITERATE_KEY,因为这是专注于触发一个属性的副作用函数,并且类型要写上
      // 因为我们之前在写普通对象时,处理了ADD和DELETE的情况,这里可以复用
      // 删除的情况就不用处理数据污染了,因为数据侮辱的原因是把响应式数据赋值到原始数据上,因为改变了响应式数据,原始数据也会跟着变
      trigger(target, value, 'DELETE')
    }
    return res
  },
  // map
  get(key) {
    const target = this[RAW_KEY]
    const had = target.has(key)
    // 追踪map的key,因为map可以通过get获取数据,所以可以追踪特定key
    track(target, key)
    if (had) {
      const res = target.get(key)
      return typeof res === 'object' ? reactive(res) : res
    }
  },
  set(key, value) {
    const target = this[RAW_KEY]
    const had = target.has(key)
    // 设置原始数据为传来的value(可能是响应式数据也可能是原始数据)
    // 如果是响应式数据那它身上就会有RAW_KEY属性,而原始数据没有RAW_KEY属性
    const oldValue = target.get(key)
    const rawValue = value[RAW_KEY] || value
    // 我们直接将原始数据赋值给key
    // target.set(key, value)
    target.set(key, rawValue)
    if (!had) {
      // ADD
      trigger(target, key, 'ADD')
    } else if (oldValue !== value || (oldValue !== oldValue && value !== value)) {
      // SET
      // 会触发绑定了ITERATE_KEY的副作用函数
      trigger(target, key, 'SET')
    }
  },
  forEach(callback, thisArg) {
    const target = this[RAW_KEY]
    // 这个wrap函数可以将传入的原始数据转换为响应式数据,这是为了解决callback函数的参数是原始数据的问题
    const wrap = (val) => (typeof val === 'object' ? reactive(val) : val)
    // 依然和ITERATE_KEY进行绑定,因为forEach的遍历时机只和数组的长度有关,所以用ITERATE_KEY
    track(target, ITERATE_KEY)
    target.forEach((v, k) => {
      // 把原始数据v,k转换为响应式数据
      callback.call(thisArg, wrap(v), wrap(k), this)
    })
  },
  // 因为[Symbol.iterator]和entries是等价的,所以可以复用iteratorMethod
  [Symbol.iterator]: iteratorMethod,
  entries: iteratorMethod,
  values: valuesIteratorMethod,
  keys: keysIteratorMethod,
}
function iteratorMethod() {
  const target = this[RAW_KEY]
  const itr = target[Symbol.iterator]()
  const wrap = (val) => (typeof val === 'object' ? reactive(val) : val)
  track(target, ITERATE_KEY)
  // 一个对象是否可迭代,需要满足两个协议:迭代器协议和可迭代协议
  // 迭代器协议要求对象实现next方法,返回一个对象,{value,done}
  // 可迭代协议要求对象实现Symbol.iterator方法,返回一个迭代器对象(这个对象必须实现next方法)
  // 所以如果一个对象实现了next方法,那么这个对象就满足了迭代器协议是一个迭代器对象
  // 再实现Symbol.iterator方法,那么这个对象就满足了可迭代协议,可以简单的直接返回this,因为this就是一个迭代器对象
  // 这样把一个普通对象变成了可迭代的对象
  return {
    // 实现迭代器协议
    next() {
      const { value, done } = itr.next()
      return {
        value: value ? [wrap(value[0]), wrap(value[1])] : value,
        done,
      }
    },
    // 实现可迭代协议
    [Symbol.iterator]() {
      return this
    },
  }
}
function valuesIteratorMethod() {
  const target = this[RAW_KEY]
  const itr = target.values()
  const wrap = (val) => (typeof val === 'object' ? reactive(val) : val)
  track(target, ITERATE_KEY)
  // 一个对象是否可迭代,需要满足两个协议:迭代器协议和可迭代协议
  // 迭代器协议要求对象实现next方法,返回一个对象,{value,done}
  // 可迭代协议要求对象实现Symbol.iterator方法,返回一个迭代器对象(这个对象必须实现next方法)
  // 所以如果一个对象实现了next方法,那么这个对象就满足了迭代器协议是一个迭代器对象
  // 再实现Symbol.iterator方法,那么这个对象就满足了可迭代协议,可以简单的直接返回this,因为this就是一个迭代器对象
  // 这样把一个普通对象变成了可迭代的对象
  return {
    // 实现迭代器协议
    next() {
      const { value, done } = itr.next()
      return {
        value: wrap(value),
        done,
      }
    },
    // 实现可迭代协议
    [Symbol.iterator]() {
      return this
    },
  }
}
function keysIteratorMethod() {
  const target = this[RAW_KEY]
  const itr = target.keys()
  const wrap = (val) => (typeof val === 'object' ? reactive(val) : val)
  track(target, MAP_KEY_ITERATE_KEY)
  // 一个对象是否可迭代,需要满足两个协议:迭代器协议和可迭代协议
  // 迭代器协议要求对象实现next方法,返回一个对象,{value,done}
  // 可迭代协议要求对象实现Symbol.iterator方法,返回一个迭代器对象(这个对象必须实现next方法)
  // 所以如果一个对象实现了next方法,那么这个对象就满足了迭代器协议是一个迭代器对象
  // 再实现Symbol.iterator方法,那么这个对象就满足了可迭代协议,可以简单的直接返回this,因为this就是一个迭代器对象
  // 这样把一个普通对象变成了可迭代的对象
  return {
    // 实现迭代器协议
    next() {
      const { value, done } = itr.next()
      return {
        value: wrap(value),
        done,
      }
    },
    // 实现可迭代协议
    [Symbol.iterator]() {
      return this
    },
  }
}

const bucket = new WeakMap()
/**
 * this variable is use for collect effect when they call ,
 * we want parent effect function can be depends for parent key but parent key depends children effect if not has this variable
 * @type {Function[]}  -
 */
const effectStack = []
/**
 * will be register effect function
 * @type {Function} activeEffect - current activeEffect will be register in bucket
 */
let activeEffect

/**
 * register effect function to bucket
 * @param {Function} wantRegisterEffectFunction - you want register effect can be anonymous function or named function
 * @param {Object} options - if you has scheduler , you can set that on options
 * @returns {Function} - you effectFun if you has lazy options
 */
function registerEffect(wantRegisterEffectFunction, options = {}) {
  // 注意,这个runEffect函数才是trigger时真正执行的副作用函数,里面包装了我们的一些处理
  // 比如cleanup,cleanup函数是用来清理自身的,也就是找到与自身所关联的属性,然后把自身从这个属性上的依赖清除掉
  // 这样一来,当一个不会被读取的响应式数据发生变化时,它所关联的副作用函数就不会再执行了
  // cleanup eg:
  // 比如：(ok:true,text:"text") reactive.ok ? reactive.text : "some"
  // 此时reactive.text会收集副作用函数,我们修改reactive.text的值时副作用函数会被重新执行
  // 这没问题,但是当reactive.ok变为false时,reactive.text的值就不会被读取了
  // 但当我们再次修改reactive.text的值时发现副作用函数仍会执行(如果我们打上log),但是并不会读取text的值,因为reactive.ok为false
  // 所以我们希望在这种情况时,与reactive.text的关联的副作用函数不会再执行(因为没有必要),于是就有了cleanup函数
  // 我们在每次执行副作用函数时都重新收集依赖关系,然后清除掉旧的依赖关系,这样就保证了副作用函数的正确执行
  // 所有我们不需要担心清除掉旧的依赖关系会影响响应式关系,因为每次执行副作用函数时都会执行与之相关的track函数(如果值被读取了),依赖就被重新收集了
  // 而不会被读取的值说明这个值暂时是没有用的,所有我们不要收集这个值的依赖关系,当这个值被读取时(有用时)我们才收集依赖关系
  const runEffect = () => {
    cleanup(runEffect) //执行副作用函数前先清除依赖关系,以免分支切换的时候有不必要的副作用依赖存在
    // 收集依赖关系,activeEffect最终会被添加到与被读取属性的依赖关系中,在属性被修改时会重新出发
    activeEffect = runEffect
    effectStack.push(runEffect)
    // 执行副作用函数,执行副作用函数的目的是触发代理对象的get拦截,然后收集依赖
    // 至于为什么要拿到因为副作用用户传来的函数的返回值,是因为这个函数可能是一个getters函数，需要执行才能拿到值,我们可以在computed和watch中使用
    const res = wantRegisterEffectFunction()
    /*
         为什么要用一个副作用栈临时储存副作用函数呢?因为要注册副作用函数(registerEffect)可能会发生嵌套,如果发生嵌套而且没有
         副作用栈的话,只有一个activeEffect,这时候执行内层副作用函数的时候,外层的副作用函数会被内层的副作用函数覆盖(activeEffect被覆盖),
         而且在内层执行完毕的时候activeEffect再次运行外层副作用函数时activeEffect也不会指向外层函数,这就导致了外层函数没有被正确的收集,导致了错误
         所以需要这么一个栈来保证每次副作用函数执行完毕时activeEffect一直指向最外层的函数
        */
    effectStack.pop()
    activeEffect = effectStack[effectStack.length - 1]
    return res
  }
  runEffect.deps = []
  runEffect.options = options
  // lazy会在computed和watch里用到,用与手动执行副作用函数
  if (!options.lazy) {
    runEffect()
  }
  // 至于为什么要把副作用函数返回,是因为我们可能需要手动执行副作用函数(lazy属性)
  // 比如在计算属性和侦听器中,我们就需要手动执行副作用函数
  return runEffect
  // registerEffect的返回值是runEffect函数,而runEffect函数的返回值是wantRegisterEffectFunction函数的返回值,所以registerEffect的返回值的返回值(注意是两层返回值)就是wantRegisterEffectFunction函数的返回值,可以用于computed和watch使用
  // 简单来说,registerEffect函数的返回值(effect)就是你传来的函数wantRegisterEffectFunction,你执行effect得到的就是wantRegisterEffectFunction的返回值
}
function cleanup(runEffect) {
  runEffect.deps.forEach((dep) => {
    // 这个函数的核心代码,找到自己的所有的父级集合(对象属性绑定过的副作用函数集合),然后在所有的父级集合中删除自己
    dep.delete(runEffect)
  })
  // for (let i = 0; i < runEffect.deps.length; i++) {
  //   /**
  //    * all depends for effect function
  //    * @type {Set} des - des
  //    */
  //   const des = runEffect.deps[i]
  //   des.delete(runEffect)
  // }
  runEffect.deps.length = 0
}
// 分支切换
// const r = reactive({ ok: true, text: 'text' })
// registerEffect(() => {
//   console.log('执行了')
//   console.log(r.ok ? r.text : 'default')
// })
// r.ok = false
// r.text = 'new text'

const data = { foo: 1, bar: 2 }
const reactive_obj = new Proxy(data, {
  get(target, key) {
    track(target, key)
    return target[key]
  },
  set(target, key, newValue) {
    target[key] = newValue
    trigger(target, key)
    return true
  },
})

// 测试this指向导致的依赖收集错误,引出了Reflect的作用
const data3 = {
  foo: 1,
  bar: function () {
    return this.foo
  },
}
const reactive_obj3 = new Proxy(data3, {
  get(target, key, receiver) {
    track(target, key)
    return Reflect.get(target, key, receiver) //receiver是为了解决this指向的问题,因为调用bar后的this是原始对象而不是代理对象,这是因为通过function声明的函数会记住定义时的定义域,也就是原始对象的词法定义域
  },
  set(target, key, newValue, receiver) {
    // target[key] = newValue
    Reflect.set(target, key, newValue, receiver)
    trigger(target, key)
    return true
  },
})

const reactive_obj6 = reactive({
  b: 1,
})
// 测试对象类型的增删
registerEffect(() => {
  for (const key in reactive_obj6) {
    // console.log(key)
  }
})
reactive_obj6.a = 2
reactive_obj6.a = 2
// 测试删除符
const reactive_obj7 = reactive({
  a: 1,
  b: 3,
  c: 4,
})
registerEffect(() => {
  for (const key in reactive_obj7) {
    // console.log(key)
  }
  // console.log(reactive_obj7.a)
  // delete reactive_obj7.a
  // console.log(reactive_obj7)
})
// delete reactive_obj7.b
reactive_obj7.a = NaN

const reactive_obj8 = reactive({
  a: 1,
  b: 3,
  c: {
    d: 4,
  },
})

registerEffect(() => {
  // console.log('deep reactive_obj8.c.d', reactive_obj8.c.d)
})

reactive_obj8.c.d = 5 // 未添加deep时无效

const child = {
  a: 1,
}
const parent = {
  b: 2,
}

const reactive_obj9 = reactive(child)
const reactive_obj10 = reactive(parent)
Object.setPrototypeOf(reactive_obj9, reactive_obj10)

registerEffect(() => {
  // console.log('reactive_obj9.b', reactive_obj9.b)
})
reactive_obj9.b = 10

const readonly_obj = readonly({
  a: 1,
  b: 2,
})
const readonly_obj2 = shallowReadonly({
  a: 1,
  b: 2,
  c: {
    d: 4,
  },
})

registerEffect(() => {
  // console.log('readonly_obj.a', readonly_obj.a)
})
// readonly_obj.a = 2
// delete readonly_obj.a

registerEffect(() => {
  // console.log('readonly_obj2.c.d', readonly_obj2.c.d)
  // console.log("readonly_obj2's keys", Object.keys(readonly_obj2))
  // console.log(
  //   Object.keys(readonly_obj2.c),
  //   Object.getOwnPropertyDescriptor(readonly_obj2.c, 'd').value
  // )
})
readonly_obj2.c.d = 5 // 不会触发更新 但是已经修改成功
// console.log(readonly_obj2.c) //{} //因为是shallowReadonly,所以c的属性还是可以修改的,但是不会触发更新
delete readonly_obj2.c.d //成功 但是不会触发更新
// console.log(readonly_obj2.c) //{} //因为是shallowReadonly,所以c的属性还是可以修改的,但是不会触发更新

const readonly_obj3 = readonly({
  a: 1,
  b: 2,
  c: {
    d: 4,
  },
})

registerEffect(() => {
  // console.log('deep test readonly_obj3.c.d', readonly_obj3.c.d)
})

// readonly_obj3.c.d = 5 // 因为是深只读,所以会报错
// delete readonly_obj3.c.d // 因为是深只读,所以会报错

// 代理数组
// 这句话其实也变相的说明了数组其实就是"对象",毕竟JavaScript万物皆对象
// 但是数组与普通对象有些不同,因为defineOwnProperty的内部方法不一样
// 能触发数组的读取操作的方式:
// 1. 通过索引访问arr[index]
// 2. 访问数组长度arr.length
// 3. 通过for...in遍历
// 4. 通过for...of遍历
// 5. 数组的原型方法,不改变原数组的一些方法:concat,every,some,filter,find,findIndex,includes,flat,flatMap,
// indexOf,join,lastIndexOf,map,reduce,reduceRight,slice,toLocaleString,toString,toLocaleString...
// 会触发读取操作
// 但是一些改变数组的方法,比如push,pop,shift,unshift这些栈方法,
// 和一些原型方法sort,reverse,splice,fill,copyWithin,
const arr1 = reactive([1, 2, 3])
registerEffect(() => {
  // console.log('arr', arr1)
  // console.log(arr1.length)
  // console.log(arr1[0])
})
// registerEffect(() => {
//   console.log('arr1.length2', arr1.length)
// })
// arr1[1] = 2
// arr1.length = 1
// const arrSum = computed(() => arr1.reduce((acc, cur) => acc + cur, 0))
// 计算属性的重新执行
// 对象的iterator方法
// const obj = {
//   a: 0,
//   [Symbol.iterator]() {
//     return {
//       next() {
//         return {
//           value: obj.a++,
//           done: obj.a > 10 ? true : false,
//         }
//       },
//     }
//   },
// }
registerEffect(() => {
  // console.log(arrSum.value)
  // for (const key in arr1) {
  //   console.log(key)
  // }
  // console.log('------------------------')
  // console.log(arr1[99])
  // for (const value of obj) {
  //   console.log(value)
  // }
})
// const arr = [1, 2, 3]
// Symbol.iterator的内部实现
// arr[Symbol.iterator] = function () {
//   const target = this
//   let index = 0
//   let length = target.length
//   console.log(target, index, length)
//   return {
//     next() {
//       return {
//         value: index < length ? target[index] : undefined,
//         done: index++ >= length,
//       }
//     },
//   }
// }
// for (const value of arr) {
//   console.log(value)
// }
registerEffect(() => {
  // 这个副作用函数会被正确的收集
  // 为什么呢?首先要明白for...of遍历的原理,它会调用对象的iterator方法,而这个方法内部的大概的实现:
  // arr[Symbol.iterator] = function () {
  //   const target = this
  //   let index = 0
  //   let length = target.length
  //   console.log(target, index, length)
  //   return {
  //     next() {
  //       return {
  //         value: index < length ? target[index] : undefined,
  //         done: index++ >= length,
  //       }
  //     },
  //   }
  // }
  // 而这个方法内会读取数组的length属性和读取每一个元素,所以数组的length数组和其元素都会与副作用函数建立联系
  // 所以无论是修改数组中已有的元素时还是添加或删除数组的元素而间接或直接的改变数组长度时,都会触发副作用函数的重新执行
  // 但是也会与Symbol.iterator这种Symbol符号建立关系,这不需要,所以我们在track的时候要去除掉
  // 如果不去掉的话会出一些意想不到的错误,比如如果你重写了响应式数据的iterator方法,但是没有去掉Symbol.iterator的依赖就会导致
  /*let type = Array.isArray(target)
        ? Number(key) < target.length
          ? 'SET'
          : 'ADD'
        : Object.prototype.hasOwnProperty.call(target, key)
        ? 'SET'
        : 'ADD'
  */
  // 中的Number转化出现错误(Symbol无法转换为数字),所以我们需要去掉Symbol.iterator的依赖(不收集)
  // for (const value of arr1 /* arr1.values()也是一样的效果,因为它也是调用iterator方法 */) {
  //   console.log(value)
  // }
})
// arr1[0] = 2
// const a = reactive({ a: 1, b: 2 })
// registerEffect(() => {
//   for (const key in a) {
//     console.log(key)
//   }
// })

// arr1[1] = 99
// arr1[99] = 3
// arr1.length = 1
// const obj = { a: 1 }
// const arr2 = reactive([1, 2, 3, obj])
// const a = [1]
registerEffect(() => {
  // includes方法可以被正常执行,这是因为includes方法会读取数组的length和被查找索引之前的索引属性
  // 所以会和数组的length属性和被查找属性和其之前的属性建立联系,因为在其之后的属性没有被读取也就没有建立联系了
  // 但是如果不加任何处理,这只在数组里的元素是原始值时才能被正确查找(结果正确)
  // 如果数组里的元素有非原始值(对象)时,includes方法的内部在读取属性值时会读取非原始值,而非原始值会被转换为响应式数据
  // 需要注意的是,在书写arr2.includes(arr2[3])时会将{a:1}建立为响应式对象,而includes内部读取这个对象的时候也会建立一个响应式对象
  /*if (res && typeof res === 'object') {
      return isReadonly ? readonly(res) : reactive(res)
    }
    */
  // 而这两个响应式对象是不同的,因为我们的实现是每次返回一个new Proxy对象,这就导致了查找失败 所以我们需要做一个缓存 reactiveMap
  // console.log(arr2.includes(2)) // true
  // console.log(arr2.includes(arr2[3])) // false 原因上述
  // console.log(arr2.includes(obj)) // false 原因下述
  // 还有一种情况就是:arr.includes(obj)直接拿原始对象去查找,这就相当于用原始对象和响应式数据作对比,肯定是false,但我们期望是true
  // 注意不要直接传入{a:1},因为obj !== {a:1} 这是两个对象,这不是框架的问题而是js的机制,在开发时也要注意
  // 所以我们需要重写includes方法 arrayInstrumentations
  // 而有些方法不需要特殊处理即可正常使用,那就是读取值
  // 但是如果和对象做比较,那又要处理了
  // arr的测试
  // console.log(arr2.find((item) => item === obj))
  // console.log(arr2.indexOf(obj))
  // console.log(arr2.find((item) => item.a === 1)) // 正确
  // console.log(arr2.filter((item) => item.a === 1)) // 正确
  // push pop shift unshift...
  // 第一个副作用函数
  // arr2.push(2)
  // arr2.splice(1, 2, 2)
  // console.log(arr2.length)
})
// 很奇怪,写上两个不同的副作用函数,会导致栈溢出maximum
// 这是因为在第一个副作用函数里使用了push方法,而这个方法根据规范可以知道,它会读取和修改数组的length属性,也就是说第一个副作用函数和length建立了联系
// 但是只有一个副作用函数的话是不会导致栈溢出的,因为我们做了处理:如果当前准备执行的副作用函数和当前激活的副作用函数相同,那就不执行trigger
// 这是为了防止在副作用函数里对属性进行修改导致的死循环(重复调用自身),因为修改属性会触发set,而set又会触发副作用函数
// 回到这个问题,那为什么写两个副作用函数就会有问题了呢?这是因为在第一个副作用函数执行完毕时,与length建立联系后,第二个副作用函数开始执行
// 而第二个副作用函数又会读取和修改length属性,于是在读取length的时候与副作用函数与length建立了联系,别忘了,紧接着,push也会进行修改
// 数组的length属性，这就导致了要把与length属性相关联的副作用函数都执行一遍(此时第二个函数还没有执行完毕)，
// 而第一个副作用函数就会被执行，而第一个副作用函数又会进行读取和修改length属性,
// 而此时,第二个副作用函数也已经与length建立了联系,于是第一个副作用函数在修改的时候,又会导致第二个副作用函数
// 执行(此时第一个副作用函数也没有执行完毕),于是在一个函数还没有执行完毕的时候,又会导致另一个函数的执行,如此循环往复,最终导致了栈溢出
// 所以我们不需要对数组的在执行栈方法时对length进行依赖收集,因为push的语义是修改而不是读取,我们不希望与length建立联系
// 所以需要一个shouldTrack变量来表示当前的副作用函数是否需要被追踪,如果不需要的话,就不收集依赖(在栈方法执行前为false,执行完后为true)
registerEffect(() => {
  // 第二个副作用函数
  // arr2.push(1)
  // arr2.splice(1)
  // console.log(arr2.length)
})
// arr2.push(3)
// console.log(arr2)
const reactive_obj11 = reactive({ a: 1 })
// 不只是数组,对象的属性在两个副作用函数里出现时也会导致栈溢出
// registerEffect(() => {
//   console.log(reactive_obj11.a++)
// })
// registerEffect(() => {
//   console.log(reactive_obj11.a++)
// })
// arr2[1] = 3 // 会触发副作用函数的重新执行

// arr2[2] = 4 // 不会触发副作用函数的重新执行
// arr2.length = 2 // 会触发副作用函数的重新执行

// set的测试
// const set = new Set([1, 2])
// const newP = reactive(set)
// 也会报错,类似size的报错,原因类似,但无法通过直接拦截get然后直接更改this解决,原因是函数的this执行时其调用的对象,而真正调用的对象是
// newP,而你只更改了delete的this,没有更改调用后的this,所以也是不行的,解决办法是用bind进行手动绑定this
registerEffect(() => {
  // 这段代码如果不加处理,会导致:
  // Uncaught TypeError: Method get Set.prototype.size called on incompatible receiver #<Set>
  // 这个错误,这是因为我们在获取set的size属性时,在内部会先检查"this"上是否存在[[SetData]]内部槽,而代理后的set的"this"是
  // receiver是代理后的set,而代理对象不存在这个内部槽,于是就会报错,解决办法就是重定向this为原始set
  // console.log(newP.size)
})
// 经过重写后的set方法,可以正确触发副作用函数的重新执行
// 为什么可以正确触发呢?因为size属性时被ITERATE_KEY所关联的,然后我们在代理普通对象的时候写了
// 处理ITERATE_KEY的情况,然后我们只需要在执行add和delete的时候传入type(ADD或DELETE即可),在trigger的时候就能正确取出
// ITERATE_KEY所关联的副作用函数,然后加到副作用函数执行栈里,这样于size(代理size并且与ITERATE_KEY关联)所关联的副作用函数就会被执行了
// newP.delete(1)
// map的测试
// const map = new Map([['key', 1]])
// const newM = reactive(map)
registerEffect(() => {
  // console.log(newM.get('key'))
})
// 在重写了map的get和set后,可以正确触发响应式
// 原因是在get里我们追踪了传入的key,然后key就与副作用函数建立了联系,这里要想清楚,副作用函数始终是我们在registerEffect
// 里传入的函数（尽管经过了我们的一些包装，但是在用户的感知上是执行的传入的函数参数，
// 而不是经过我们各种中转和改变this指向或者代理等等,不要混淆了,因为我们是把activeEffect加到key的依赖集合里的
// 而activeEffect的值始终等于当前正在执行的副作用函数，所以最后执行的副作用函数也是我们传入的函数
// newM.set('key', 2)

// *map的污染问题测试
// 注意观察,如果我们不加处理,用户就可以书写以下的代码,即:用原始Map操作响应式数据,这是很不对的
// 因为原始数据和响应式数据应该是分开的,不应该混淆,不然用户既可以使用原始数据又可以使用响应式数据,这会导致代码混乱
// 理想情况应个不存在的属性时,就会改变size的长度,也就会导致更新啦
// 解决办法是如果一个map要设置一个响应式数据为它的value,那么就把响应式数据的原始数据设置给它,不用担心这样会导致响应式丢失
// 因为如果一个map能使用我们该是我们操作原始数据时期望应该是不会触发响应式更新，而操作响应式数据时期望会触发响应式更新
// 出现这种问题的原因是我们用原始数据进行set操作时(newMap1.set('newMap2', newMap2))会把响应式数据(newMap2)原封不动的设置在
// 响应式数据newMap1上，而我们的实现是重写了Map的set和get方法，它们的数据流向最终都会是原始数据，所以原始数据map1上也存在newMap2
// 所以在我们使用map1获取newMap2时，实际上获取到的是响应式数据newMap2，那么自然就会触发相应的更新了（与size关联的副作用函数）
// 因为在注册副作用函数时，我们通过map1.get("newMap2")拿到了这个响应式数据,然后将它的size和副作用函数绑定在了一起
// 那么在对map进行set一重写的方法,那么它一定是响应式数据,而我们做了深响应处理,所以我们可以保证响应式数据不会丢失
// 而且我们也可以保证如果一个原始对象想将一个响应式数据设置为一个value,我们会将这个响应式数据的原始值设置给它
// 这样就可以避免原始数据中某一个key的值是响应式数据,这样就解决了原始数据被污染的问题

// 下面是一个与污染问题无关的总结,恰好想到
// 这里多说一个,如果set了一个已经存在的key,不用担心不会触发更新,因为我们在get的时候已经追踪了这个key,
// 所以set的时候只要之前用到了这个key(即调用了get方法),那么就会收集与key相关的依赖,然后在set的时候通过
// 设置type为SET（语义）来触发副作用函数的重新执行（在trigger里）
// const map1 = new Map()
// const newMap1 = reactive(map1)
// const map2 = new Map()
// const newMap2 = reactive(map2)
// 这句代码会将newMap2间接的设置到map1上,因为我们重写了map的set的方法(这本身没问题,有问题的是通过原始数据访问的响应式数据也会触发更新,这是不期望的
// 原因上述
// newMap1.set('newMap2', newMap2)
registerEffect(() => {
  // console.log(map1.get('newMap2').size)
})
// 经过map的防污染处理,这句代码执行完毕后,副作用函数不会再执行了,因为它是完全的原始数据,和我们所写的响应式系统没有一点关系
// map1.get('newMap2').set('foo', 1)
// *测试Set的数据污染,测出问题原因类似,已解决
// const set1 = new Set()
// const newSet1 = reactive(set1)
// const set2 = new Set()
// const newSet2 = reactive(set2)
// newSet1.add(newSet2)
// registerEffect(() => {
//   console.log(set1.values().next().value.size)
// })
// set1.forEach((item) => {
//   if (item === newSet2) {
//     item.add('foo')
//   }
// })
// *测试数组的数据污染,测出问题原因类似,已解决
// const arr3 = [1, 2, 3]
// const newArr3 = reactive(arr3)
// const arr4 = [4]
// const newArr4 = reactive(arr4)
// newArr3.push(newArr4)
// registerEffect(() => {
//   console.log(arr3[3].length)
// })
// arr3[3].push(5)
// *测试对象的数据污染,测出问题原因类似,都是访问到了响应式数据导致的数据污染,已解决
// const obj1 = { a: 1 }
// const newObj1 = reactive(obj1)
// const obj2 = { b: 2 }
// const newObj2 = reactive(obj2)
// newObj1.c = newObj2
// registerEffect(() => {
// console.log(obj1.c.b)
// })
// obj1.c.b = 3

// *测试集合类型的foreach方法
// const key = { key: 1 }
// const value = new Set([1, 2, 3])
// const objValue = { a: 1 }
// const numberValue = 1
// const map = reactive(new Map([[key, value]]))
// const map2 = reactive(new Map([[key, objValue]]))
// const map3 = reactive(new Map([[key, numberValue]]))
// registerEffect(() => {
//   //
//   map.forEach((value, key) => {
//     console.log(value.size)
//     console.log('--------------')
//   })
// })
// registerEffect(() => {
//   map2.forEach((value, key) => {
//     console.log(value.a)
//     console.log('--------------')
//   })
// })
// registerEffect(() => {
//   map3.forEach((value, key) => {
//     console.log(value)
//     console.log('--------------')
//   })
// })
// map.get(key).add(4)
// map2.get(key).a = 2
// map3.set(key, 2)
// // set
// const set = reactive(new Set([1, 2, 3]))
// registerEffect(() => {
//   console.log(set.size)
// })

// *测试集合类型的迭代器方法:values,entries,keys
// const map = new Map([
//   ['key1', 1],
//   ['key2', 2],
// ])

// for (const [key, value] of map.entries()) {
//   console.log(key, value) // ['key1', 1], ['key2', 2]
// }
// for (const [key, value] of map[Symbol.iterator]()) {
//   console.log(key, value) // ['key1', 1], ['key2', 2]
// }
// const itr = map[Symbol.iterator]()
// console.log(itr.next().value) // ['key1', 1]
// console.log(itr.next().value) // ['key2', 2]
// console.log(itr.next().value) // undefined
// console.log(map.entries === map[Symbol.iterator]) // true\

// const map = reactive(
//   new Map([
//     ['key1', 1],
//     ['key2', 2],
//   ])
// )
// registerEffect(() => {
//   // 如果不加处理,会报错: map is not iterable , 需要在重写for of方法,把原始map的迭代器返回
//   // 别忘了把参数包装成响应式数据(wrap)
//   for (const [key, value] of map) {
//     console.log(key, value)
//   }
//   console.log('[Symbol.iterator] ------')
// })
// registerEffect(() => {
//   // 如果不加处理,会报错: map is not iterable , 需要在重写for of方法,把原始map的迭代器返回
//   // 别忘了把参数包装成响应式数据(wrap)
//   for (const [key, value] of map.entries()) {
//     console.log(key, value)
//   }
//   console.log('entries ------')
// })
// registerEffect(() => {
//   for (const value of map.values()) {
//     console.log(value)
//   }
//   console.log('values ------')
// })
// registerEffect(() => {
//   for (const keys of map.keys()) {
//     console.log(keys)
//   }
//   console.log('keys ------')
// })
// // 可以触发更新,因为我们追踪了ITERATE_KEY和MAP_KEY_ITERATE,当操作类型为ADD或DELETE时,会触发副作用函数的重新执行
// map.set('key3', 3)
// // 不期望keys也能更新,所以需要对keys进行额外处理,需要另外一个全局抽闲的key来标识,MAP_KEY_ITERATE_KEY
// map.set('key2', 4)

// *测试ref
// const val = ref(1)
// console.log(val)
// registerEffect(() => {
//   console.log(val['__v_isRef'])
// })
// // 可以正常执行,但只是简单的包裹一下还不完美:无法区分ref和reactive,所以需要一个标识符来表示一个响应式数据是不是ref(__v_isRef)
// // const newVal = reactive(val)
// val.value = 2
// 响应式丢失问题
// const obj2 = reactive({ a: 1, b: 2 })
// const newObj2 = {
//   ...toRefs(obj2),
// }
// registerEffect(() => {
//   console.log(newObj2.a.value)
// })
// obj2.a = 2
// 自动脱ref
// const obj2 = reactive({ a: 1, b: 2 })
// const newObj2 = proxyRefs({ ...toRefs(obj2) })
// registerEffect(() => {
//   console.log(newObj2.a)
// })
// newObj2.a = 2
// const count = ref(0)
// const obj2 = reactive({ count: proxyRefs(count) })
// registerEffect(() => {
//   // console.log(obj2.count)
//   console.log(count.value)
// })
// count.value++
// obj2.count = 1
// obj2.count = 2

function shallowReactive(obj) {
  return createReactive(obj, true)
}

function reactive(obj) {
  let proxy = reactiveMap.get(obj)
  if (!proxy) {
    proxy = createReactive(obj)
    reactiveMap.set(obj, proxy)
  }
  return proxy
}

function readonly(obj) {
  return createReactive(obj, false, true)
}

function shallowReadonly(obj) {
  return createReactive(obj, true, true)
}

function ref(val) {
  const wrapper = {
    value: val,
  }
  Object.defineProperty(wrapper, '__v_isRef', { value: true })
  return reactive(wrapper)
}

// 这个函数是快速从一个响应式对象上提取某个属性作为响应式对象使用
function toRef(obj, key) {
  const wrapper = {
    get value() {
      return obj[key]
    },
    set value(newVal) {
      obj[key] = newVal
    },
  }
  Object.defineProperty(wrapper, '__v_isRef', { value: true })
  return wrapper
}
// 同上,只是把一个响应式对象全部提取为响应式对象(相当于浅拷贝一份)
// 所以通过toRef得到的响应式数据,修改自身或者原来的响应式数据都能触发更新
function toRefs(obj) {
  const res = {}
  for (const key in obj) {
    res[key] = toRef(obj, key)
  }
  return res
}

// 自动脱ref,主要是为了在模版里不用写count.value这样的繁琐代码
function proxyRefs(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      return isRef(value) ? value.value : value
    },
    set(target, key, newValue, receiver) {
      const value = target[key]
      if (isRef(value)) {
        value.value = newValue
        return true
      }
      return Reflect.set(target, key, newValue, receiver)
    },
  })
}

function isRef(val) {
  return val['__v_isRef'] === true
}

function createReactive(obj, isShallow = false, isReadonly = false) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      if (key === RAW_KEY) {
        return target
      }

      // *Set和Map的代理
      // 当访问map和set这个数据本身时,会进入get拦截函数,注意,这个get并不是这些数据自身的get方法,而是你想
      // 访问map和set时就会触发,比如map.get(),会拦截你访问get这个方法本身,然后将我们重写后的map.get方法返回
      // 从而实现对map的响应式
      const targetType = target.toString().slice(8, -1) //Object,Map,Set...
      if (targetType === 'Map' || targetType === 'Set') {
        if (key === 'size') {
          // 为什么要用ITERATE_KEY作为key呢?因为size的会被set的新增和删除操作影响,所以我们不能只绑定某个属性,要绑定一个唯一的
          // 在新增和删除后都触发副作用函数重新执行
          track(target, ITERATE_KEY)
          return Reflect.get(target, key, target)
        }
        // 改变this执行可以使得代理set的方法可以正常执行,但是无法满足我们响应式化set的要求,所以我们需要重写add和set方法
        // 使其在执行后能够触发副作用函数重新执行
        // return target[key].bind(target)
        return mutableInstrumentations[key]
      }

      // *普通对象和数组的代理
      // return Reflect.get(target, key, receiver)

      // 将arr.incldes重定向到arrayInstrumentations.includes
      if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) {
        return Reflect.get(arrayInstrumentations, key, receiver)
      }
      // 如果是只读对象,那么就不需要收集依赖了,因为只读属性不会被修改,也就不需要触发副作用函数
      // 不用担心会影响到{}型对象的for...in/of的依赖收集,因为{}型对象的for...in/of依赖收集是在ownKeys方法中进行的(我们用了ITERATE_KEY作为键名来标识)
      // 那至于为什么这里需要排除symbol呢?是因为在使用for...in/of遍历数组时(注意,是数组,而不是{}型对象)会读取数组的
      // Symbol.iterator属性,所以会对Symbol.iterator属性建立依赖,而Symbol.iterator属性本身是不会被修改的,所以不需要收集依赖
      if (!isReadonly && typeof key !== 'symbol') {
        track(target, key)
      }
      const res = Reflect.get(target, key, receiver)
      // shallow reactive
      if (isShallow) {
        return res
      }
      // deep reactive and readonly
      if (res && typeof res === 'object') {
        return isReadonly ? readonly(res) : reactive(res)
      }
      return res
    },
    set(target, key, newValue, receiver) {
      if (isReadonly) {
        console.warn(`this property [${key}] is readonly , you can't set value`)
        return true
      }
      // 刚进入get的时候值还没有被修改,因为这是"拦截"
      // 获取旧值,目的是只有当值真的被修改了才执行trigger,
      // 不然只是触发set就执行是有问题的
      const oldValue = target[key]
      // 也是一样的处理方式,数组和普通对象,防止数据污染
      const rawValue = newValue[RAW_KEY] || newValue
      // 一定要先判断修改的是什么,不然修改完了再判断那永远都是SET
      let type = Array.isArray(target)
        ? Number(key) < target.length
          ? 'SET'
          : 'ADD'
        : Object.prototype.hasOwnProperty.call(target, key)
        ? 'SET'
        : 'ADD'
      const res = Reflect.set(target, key, rawValue, receiver)
      // 这是为了解决对象修改父级属性时(自身不存在此属性),副作用函数会执行两次的问题
      // 修改属性时,会先触发子属性的set,但是没有找到此属性,于是会触发父级属性的set
      // 但是这两次set的receiver都是子级,所以可以通过这种方式判断当前触发的对象是不是与receiver相匹配的对象
      if (receiver[RAW_KEY] === target) {
        if (
          oldValue !== newValue &&
          /* 这两个或全等的目的是排除新旧值都是NaN的情况,只有一个是NaN的话是可以触发的 */
          (oldValue === oldValue || newValue === newValue)
        ) {
          // 传入newValue是为了修改数组长度时,需要对索引大于等于新长度(newValue)的元素进行触发副作用函数重新执行

          trigger(target, key, type, newValue)
        } else {
          // console.trace('oldValue === newValue')
        }
      }
      return res
    },
    has(target, key) {
      track(target, key)
      return Reflect.has(target, key)
    },
    ownKeys(target) {
      // 因为执行for in/of的时候会调用对象的ownKeys方法,而这个方法
      // 是不用传入key的(当然)所以如果我们想收集这个依赖的话,需要一个
      // 额外的唯一标识来收集这些依赖(用Symbol作为标识,谁还敢说Symbol没用?!)
      // 如果是target是数组的话,直接用length作为键就行了,因为对数组的增删其实就是对length的增删
      track(target, Array.isArray(target) ? 'length' : ITERATE_KEY)
      // 相应的,触发的时候也要从ITERATE_KEY或length里的副作用函数集合中拿到副作用函数
      return Reflect.ownKeys(target)
    },
    deleteProperty(target, key) {
      if (isReadonly) {
        console.warn(`this property [${key}] is readonly , you can't delete property`)
        return true
      }
      const hadKey = Object.prototype.hasOwnProperty.call(target, key)
      const res = Reflect.deleteProperty(target, key)
      if (hadKey && res) {
        trigger(target, key, 'DELETE')
      }
      return res
    },
  })
}

/**
 * will trigger when target[key]-value changed
 * @param {object} target  - same on track
 * @param {string | object} key  - same on track
 * @returns {void}
 */
function trigger(target, key, type, newValue) {
  let desMap = bucket.get(target) // 永远是当前操作的对象的依赖Map,与其他对象无关
  let des = desMap && desMap.get(key) // 永远是当前操作对象的当前操作的key的依赖集合,与其他key无关
  const runEffectFunctions = new Set() // 真正会执行的副作用函数集合
  const targetType = target.toString().slice(8, -1) //Object,Map,Set...

  des &&
    des.forEach((fun) => {
      if (activeEffect !== fun) {
        runEffectFunctions.add(fun)
      }
    })
  // type是操作的类型,比如ADD,SET,DELETE
  // targetType是数据的类型,比如Object,Map,Set...
  // 就map而言,forEach即关心key也关心value,所以在对Map有set的时候也要触发副作用函数重新执行
  if (type === 'ADD' || type === 'DELETE' || (type === 'SET' && targetType === 'Map')) {
    // 因为对象被添加或者被删除属性的时候,会影响键的个数,所以需要重新执行与ITERATE_KEY有关的副作用函数
    // map和set也可以用到这个
    const iterateDes = desMap && desMap.get(ITERATE_KEY)
    iterateDes &&
      iterateDes.forEach((fun) => {
        if (activeEffect !== fun) {
          runEffectFunctions.add(fun)
        }
      })
  }
  if (type === 'ADD' || (type === 'DELETE' && type === 'SET' && targetType === 'Map')) {
    // map和keys方法专属
    const iterateDes = desMap && desMap.get(MAP_KEY_ITERATE_KEY)
    iterateDes &&
      iterateDes.forEach((fun) => {
        if (activeEffect !== fun) {
          runEffectFunctions.add(fun)
        }
      })
  }
  // 处理数组, eg :arr = ["bar"]; 当执行 arr[1] = "foo" 时数组会发生长度改变(规范),需要触发关于length的副作用函数执行
  if (type === 'ADD' && Array.isArray(target)) {
    //对数组进行for in操作时我们会对length进行追踪,因为拦截了ownKeys方法,所以在改变数组长度时也会重新执行副作用函数
    const lengthEffects = desMap && desMap.get('length')
    lengthEffects &&
      lengthEffects.forEach((fun) => {
        if (activeEffect !== fun) {
          runEffectFunctions.add(fun)
        }
      })
  }
  // 这是处理直接修改数组长度时,需要触发索引大于等于新长度(newValue)的元素的副作用函数重新执行
  if (key == 'length' && Array.isArray(target)) {
    // 这里的desMap的值就是与当前数组相关的副作用函数map,map的key是数组的索引,值是与索引相关的副作用函数集合
    // 每一个索引对应1个或者多个副作用函数
    desMap &&
      desMap.forEach((effects, key) => {
        // 这里的key不是length,而是数组中被绑定了副作用函数的索引
        if (key >= newValue) {
          effects.forEach((effect) => {
            if (activeEffect !== effect) {
              runEffectFunctions.add(effect)
            }
          })
        }
      })
  }

  // 真正执行副作用函数,前面那些都是在添加
  runEffectFunctions.forEach((effectFun) => {
    if (effectFun.options.scheduler) {
      effectFun.options.scheduler(effectFun)
    } else {
      effectFun()
    }
  })
}

/**
 * track depends for target
 * @param {object} target - you want track depends obj
 * @param {string | object} key - will be add effect function
 * @returns {void}
 */
function track(target, key) {
  if (!activeEffect || !shouldTrack) {
    return
  }
  // bucket.add(activeEffect);
  /**
   * desMap
   * @type {Map} desMap - the target key will depends in effect function'map
   */
  let desMap = bucket.get(target)
  if (!desMap) {
    bucket.set(target, (desMap = new Map()))
  }
  /**
   * des
   * @type {Set} des - effect Set container
   */
  let des = desMap.get(key)
  if (!des) {
    desMap.set(key, (des = new Set()))
  }
  des.add(activeEffect)
  // 将依赖集合添加到deps中,方便清除副作用函数
  activeEffect.deps.push(des)
}

// computed
function computed(getter) {
  let value
  let dirty = true
  // 这个effect就是用户传入的getter函数
  const effect = registerEffect(getter, {
    // 调度器的执行在属性被set时执行(trigger)
    // this scheduler function will call be getter internal reactive data changed
    // 这个调度器会在属性发生改变时被执行,所有我们把dirty设置为true,以此表示值脏了,
    // 需要重新执行getter函数(用户传来的函数,必须是一个getters函数,即:有返回值的函数)
    scheduler(effectFun) {
      // effectFun no need run in this scheduler , because we run this function when you get value
      // we just do we want do thing on this scheduler eg: you self code
      if (!dirty) {
        dirty = true
        // we HM call trigger call computed'effect when getter includes reactive value changed
        // 在值脏了以后手动触发副作用函数
        trigger(obj, 'value')
      }
    },
    // 为什么是懒执行呢?因为我们需要对副作用函数的执行时机进行控制,
    // 比如只有当用户读取value属性并且值发生改变时才执行副作用函数,
    // lazy为true时不会立即执行副作用函数(在注册时),也就不会立即建立依赖,需要我们手动执行registerEffect的返回值(effext)时才会建立依赖(触发读取)
    lazy: true,
  })

  const obj = {
    get value() {
      if (dirty) {
        // 在每次值被改变时读取value都会重新执行effect函数从而重新收集依赖并更新value的值(最新)
        value = effect() //这个函数的返回值就是传入的getter函数的返回值,所以computed函数的返回值就是getter函数的返回值,但中间我们做了computed的一些处理(依赖收集)
        dirty = false
        // we HM call track collect computed'effect when computed'value get
        // 手动收集计算属性的依赖(在registerEffect函数里传入的函数)
        track(obj, 'value')
      }
      return value
    },
  }
  return obj
}

// watch
/**
 * 这个函数的作用是遍历一个对象所有属性,包括子属性,如果值是对象,则递归调用遍历函数,目的就是单纯的读取,不做任何事情
 */
function traverse(value, seen = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return
  }
  seen.add(value)
  for (const key in value) {
    traverse(value[key], seen)
  }
  return value
}
/**
 * watch function can watch obj or value change an call you self function
 * @param {Function | Object} source - you can input getter or specific obj value we will
 * call getter to track depends
 * @param {Function} cb - you self function , that call when source includes reactive value changed
 * @returns {void}
 */
function watch(source, cb, options = {}) {
  let getter
  if (typeof source === 'function') {
    getter = source
  } else {
    getter = () =>
      traverse(
        source
      ) /* traverse函数并不是为了干什么事情,而是为了读取,就是单纯的读取操作,因为要收集依赖*/
  }
  let newValue, oldValue

  let cleanFun

  // 注册一个清除函数,传入的参数是一个函数,这个函数里做一些清除工作
  // 因为是闭包,所以会记住作用域,在下次执行副作用函数时,会调用这个函数,用来执行一些清理工作
  function onInvalidate(fun) {
    // 闭包,会记住传入的fun的作用域
    cleanFun = fun
  }

  function doJob() {
    // that step is get latest value
    newValue = effectFun()
    // that branch will execute when register onInvalidate function , cleanFun variable will change to be you register function , if that exist then will call before with watch callback
    // 其实是调用了上次传入的清除函数,执行清理工作,然后再执行当前的副作用函数
    if (cleanFun) {
      cleanFun()
    }
    // you callback function
    cb(newValue, oldValue, onInvalidate)
    oldValue = newValue
  }

  // 这是watch的核心,这个effectFun的返回值就是传入的getter的返回值,也就是我们传入的要观察的值
  /**
   *registerEffect function return value is runEffect:24 function , that function return value is effect function return value,
   *in this case watch function first argument is obj or getter , any way , we all transform getter that return value is that includes reactive data
   *so,registerEffect function return value is we want that return value,because runEffect will return we input effect function return value
   **/
  const effectFun = registerEffect(
    () => getter() /* 这个getter很有意思,需要经常揣摩,目的其实就是进行依赖收集(读取值)*/,
    {
      lazy: true, // 设置懒执行是因为我们需要手动管理副作用函数的执行时机,比如立即执行啊,和获取新久值啊
      scheduler() {
        if (options.flush === 'post') {
          const p = Promise.resolve()
          p.then(doJob)
        } else {
          doJob() //在值被修改时执行回调函数
        }
      },
    }
  )
  if (options.immediate) {
    doJob() // 此时oldValue的值是undefined,因为还没有被修改过,所以oldValue是undefined
  } else {
    oldValue = effectFun()
  }
}

// run
let finalData = reactive({ data: 1 })

const data2 = { name: 'xygod', email: '1323943635@qq.com' }
const reactive_obj2 = new Proxy(data2, {
  get(target, key) {
    track(target, key)
    return target[key]
  },
  set(target, key, newValue) {
    target[key] = newValue
    trigger(target, key)
    return true
  },
})
watch(
  () => reactive_obj2,
  async (newValue, oldValue, onInvalidate) => {
    let expired = false
    // 作为过期回调函数,其实就是相对于第二次修改监听的值后第一次的回调函数,那第一次的回调函数我们称为过期的回调函数,我们需要对过期的回调函数做一些事情
    // 传入的回调函数其实就是闭包的实际应用,能记住当前作用域
    // 因为我们注册的过期函数会在执行下次effect时被调用,所以每次执行的过期回调函数其实是上次watch的回调函数注册的过期回调函数，因为是闭包，所以能记住上次的回调函数的作用域(这是重点)
    // 因此我们可以在下一次执行副作用函数时可以执行上一次的过期函数,以便对竞态问题进行处理
    // 解决竞态问题
    onInvalidate(() => {
      expired = true
    })
    const res = await new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve(newValue)
      }, 400)
    })

    if (!expired) {
      finalData.data = res
    }
  },
  {
    immediate: false,
    flush: 'post',
  }
)

// reactive_obj2
// 竞态问题
reactive_obj2.name = '南笙芷'
setTimeout(() => {
  reactive_obj2.name = '南笙芷2'
}, 300)

reactive_obj.bar++
reactive_obj.foo++

// run

let temp1, temp2
// scheduler
const jobQueue = new Set()
// 副作用执行去重,多次修改操作合并成一次操作(只执行最新的一次)
const p = Promise.resolve()

let isFlushing = false
function flushJob() {
  if (isFlushing) {
    return
  }
  isFlushing = true
  p.then(() => {
    jobQueue.forEach((job) => {
      job()
    })
  }).finally(() => {
    isFlushing = false
  })
}
const effect = registerEffect(() => {}, {
  lazy: true,
  who: 'test',
})
const effectValue = effect()

const sum = computed(() => {
  // reactive_obj.bar and reactive_obj.foo will collect this effectFun , when they value changed ,the function will be call
  return reactive_obj.bar + reactive_obj.foo
})

//if we no handle this case( trigger(obj, 'value'):137 and track(obj, 'value'):148 ) , the will not work,
//because computed has own effectFun and this effectFun call with get value, and computed'getter only collect computed internal effect because we do this,
//that good in general,but in this case , we want computed'effect( function(){console.log(sum.value)} ) can be call when computed'getter includes reactive value changed,
//in this case,we need HM track and trigger computed'effect when computed'get call track and computed includes reactive value changed call trigger (on computed internal effect , we can call trigger(obj,"value") -- obj is we define local variable and value is obj value attribute , if you want , you can eval define you_name_obj and you_name_value)
registerEffect(() => {
  // console.log(sum.value)
})
// 计算属性的test
reactive_obj.bar++
reactive_obj.bar++
reactive_obj.bar++
