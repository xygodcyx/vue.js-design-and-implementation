const minVue = (function (exports) {
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
            doJob()
          }
        },
      }
    )
    if (options.immediate) {
      doJob()
    } else {
      oldValue = effectFun()
    }
  }
  exports.effect = registerEffect
  exports.computed = computed
  exports.watch = watch
  exports.reactive = reactive
  exports.shallowReactive = shallowReactive
  exports.readonly = readonly
  exports.shallowReadonly = shallowReadonly
  exports.ref = ref
  return exports
})({})
