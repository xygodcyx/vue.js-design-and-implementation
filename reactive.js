'use strict'

// {}型对象的 for...in/of 的依赖收集 唯一键名
let ITERATE_KEY = Symbol() //Returns a new unique Symbol value.

// 为了解决类似于数组includes方法查找非原始值会将两个不同的代理对象(或一个代理对象一个原始值,比如直接在includes里传入非原始值{a:1}而不是通过响应式数据的索引)
// 进行比较,而这就导致了和预期不同的结果(明明键值对完全一样,但是不相等--new proxy的原因,既然new proxy无法改变,那么就
// 用一个"缓存"来把之前已经代理过的对象存起来,然后取的时候直接从"缓存"里取就行了 reactiveMap
const reactiveMap = new Map()
// 这是为了重写数组的includes方法,让arr2.includes({a:1})也可以被正确查找
// 思路就是在proxy拦截get的时候,判断当前操作数组的key(arr.includes)在不在这个我们覆写的对象上,在就返回我们覆写的这个对象
// 这种方法的可行性的依据是数组在读取原型方法时,实际上是读取了属性(includes,indexOf...),于是我们可以进行拦截这些(key)
// 然后返回我们自己定义的includes方法,这样就实现了数组的includes方法的覆写
const arrayInstrumentations = {}
;['includes', 'indexOf', 'find'].forEach((key) => {
  const originalMethod = Array.prototype[key]
  // 其中this是代理数组,因为我们用Reflect.get将this改变为代理对象(receiver,即实际调用对象而不是原始对象)
  arrayInstrumentations[key] = function (...args) {
    let res = originalMethod.apply(this, args)
    // 如果没有找到,说明传来的参数不是代理对象而是一个原始值,所有我们需要获取代理对象的原始值(data.raw)
    if (!res) {
      res = originalMethod.apply(this.raw, args)
    }
    return res
  }
})

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
  if (!options.lazy) {
    runEffect()
  }
  // 至于为什么要把副作用函数返回,是因为我们可能需要手动执行副作用函数(lazy属性)
  // 比如在计算属性和侦听器中,我们就需要手动执行副作用函数
  return runEffect //registerEffect的返回值是runEffect函数,而runEffect函数的返回值是wantRegisterEffectFunction函数的返回值,所以registerEffect的返回值的返回值(注意是两层返回值)就是wantRegisterEffectFunction函数的返回值,可以用于computed和watch使用
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
  /* 
   let type = Array.isArray(target)
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
const obj = { a: 1 }
const arr2 = reactive([1, 2, 3, obj])
const a = [1]
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
  console.log(arr2.includes(obj)) // false 原因下述
  // 还有一种情况就是:arr.includes(obj)直接拿原始对象去查找,这就相当于用原始对象和响应式数据作对比,肯定是false,但我们期望是true
  // 注意不要直接传入{a:1},因为obj !== {a:1} 这是两个对象,这不是框架的问题而是js的机制,在开发时也要注意
  // 所以我们需要重写includes方法 arrayInstrumentations
  // 而有些方法不需要特殊处理即可正常使用,那就是读取值
  // 但是如果和对象做比较,那又要处理了
  console.log(arr2.find((item) => item === obj))
  // console.log(arr2.find((item) => item.a === 1)) // 正确
  // console.log(arr2.filter((item) => item.a === 1)) // 正确
})
// arr2[1] = 3 // 会触发副作用函数的重新执行
// arr2[2] = 4 // 不会触发副作用函数的重新执行
// arr2.length = 2 // 会触发副作用函数的重新执行

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

function createReactive(obj, isShallow = false, isReadonly = false) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      if (key === 'raw') {
        return target
      }
      // 将arr.incldes重定向到arrayInstrumentations.includes
      if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) {
        return Reflect.get(arrayInstrumentations, key, receiver)
      }
      // 如果是只读对象,那么就不需要收集依赖了,因为只读属性不会被修改,也就不需要触发副作用函数
      // 不用担心会影响到{}型对象的for...in/of的依赖收集,因为{}型对象的for...in/of依赖收集是在ownKeys方法中进行的
      // 哪至于为什么这里需要排除symbol呢?是因为在使用for...in/of遍历数组时(注意,是数组,而不是{}型对象)会读取数组的
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
      // 一定要先判断修改的是什么,不然修改完了再判断那永远都是SET
      let type = Array.isArray(target)
        ? Number(key) < target.length
          ? 'SET'
          : 'ADD'
        : Object.prototype.hasOwnProperty.call(target, key)
        ? 'SET'
        : 'ADD'
      const res = Reflect.set(target, key, newValue, receiver)
      // 这是为了解决对象修改父级属性时(自身不存在此属性),副作用函数会执行两次的问题
      // 修改属性时,会先触发子属性的set,但是没有找到此属性,于是会触发父级属性的set
      // 但是这两次set的receiver都是子级,所以可以通过这种方式判断当前触发的对象是不是与receiver相匹配的对象
      if (receiver.raw === target) {
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
      // 相应的,触发的时候也要从ITERATE_KEY里读取依赖
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
  let desMap = bucket.get(target)
  let des = desMap && desMap.get(key)
  const runEffectFunctions = new Set()

  des &&
    des.forEach((fun) => {
      if (activeEffect !== fun) {
        runEffectFunctions.add(fun)
      }
    })
  if (type === 'ADD' || type === 'DELETE') {
    // 因为对象被添加或者被删除属性的时候,会影响键的个数,所以需要重新执行与ITERATE_KEY有关的副作用函数
    const iterateDes = desMap && desMap.get(ITERATE_KEY)
    iterateDes &&
      iterateDes.forEach((fun) => {
        if (activeEffect !== fun) {
          runEffectFunctions.add(fun)
        }
      })
  }
  // 处理数组的情况 , arr = ["bar"] 但是复制的时候 arr[1] = "foo" 于是就是数组长度改变了(规范),需要触发length的副作用函数重新执行
  if (type === 'ADD' && Array.isArray(target)) {
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
  if (!activeEffect) {
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
    lazy: true,
  })

  const obj = {
    get value() {
      if (dirty) {
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
 * 这个函数的作用是遍历一个对象所有属性,包括子属性,如果值是对象,则递归调用遍历函数
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
    getter = () => traverse(source)
  }
  let newValue, oldValue

  let cleanFun

  function onInvalidate(fun) {
    cleanFun = fun
  }

  function doJob() {
    // that step is get latest value
    newValue = effectFun()
    // that branch will execute when register onInvalidate function , cleanFun variable will change to be you register function , if that exist then will call before with watch callback
    if (cleanFun) {
      cleanFun()
    }
    // you callback function
    cb(newValue, oldValue, onInvalidate)
    oldValue = newValue
  }

  /**
   *registerEffect function return value is runEffect:24 function , that function return value is effect function return value,
   *in this case watch function first argument is obj or getter , any way , we all transform getter that return value is that includes reactive data
   *so,registerEffect function return value is we want that return value,because runEffect will return we input effect function return value
   **/
  const effectFun = registerEffect(() => getter() /* 这个getter很有意思,需要经常揣摩 */, {
    lazy: true, // 设置懒执行是因为我们需要手动管理副作用函数的执行时机,比如立即执行啊,和获取新久值啊
    scheduler() {
      if (options.flush === 'post') {
        const p = Promise.resolve()
        p.then(doJob)
      } else {
        doJob()
      }
    },
  })
  if (options.immediate) {
    doJob()
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
