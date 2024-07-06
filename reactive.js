'use strict'

const bucket = new WeakMap()
/**
 * this variable is use for collect effect when they call ,
 * we want parent effect function can be depends for parent key but parent key depends children effect
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
	const runEffect = () => {
		cleanup(runEffect) //执行副作用函数前先清除依赖关系,以免分支切换的时候有不必要的副作用依赖存在
		// 收集依赖关系
		activeEffect = runEffect
		effectStack.push(runEffect)
		// 执行副作用函数,执行副作用函数的目的是触发代理对象的get拦截,然后收集依赖
		// 至于为什么要拿到因为副作用函数可能是一个getters函数，需要执行才能拿到值,我们可以在computed和watch中使用
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
	return runEffect //registerEffect的返回值是runEffect函数,而runEffect函数的返回值是wantRegisterEffectFunction函数的返回值,所以registerEffect的返回值的返回值(注意是两层返回值)就是wantRegisterEffectFunction函数的返回值,可以用于computed和watch使用
}
function cleanup(runEffect) {
	for (let i = 0; i < runEffect.deps.length; i++) {
		/**
		 * all depends for effect function
		 * @type {Set} des - des
		 */
		const des = runEffect.deps[i]
		des.delete(runEffect)
	}
	runEffect.deps.length = 0
}

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
// for in/of 的依赖收集 唯一键名
let ITERATE_KEY = Symbol() //Returns a new unique Symbol value.
const reactive_obj6 = reactive({
	b: 1,
})
// 测试对象类型的增删
registerEffect(() => {
	for (const key in reactive_obj6) {
		console.log(key)
	}
})
reactive_obj6.a = 2
reactive_obj6.a = 2
// 测试删除符
const reactive_obj7 = reactive({
	a: 2,
	b: 3,
	c: 4,
})
registerEffect(() => {
	for (const key in reactive_obj7) {
		console.log(key)
		delete reactive_obj7[key]
	}
	// delete reactive_obj7.a
	// console.log(reactive_obj7)
})
delete reactive_obj7.b

function reactive(obj) {
	return new Proxy(obj, {
		get(target, key, receiver) {
			track(target, key)
			return Reflect.get(target, key, receiver)
		},
		set(target, key, newValue, receiver) {
			// 一定要先判断修改的是什么,不然修改完了再判断那永远都是SET
			let type = Object.prototype.hasOwnProperty.call(target, key)
				? 'SET'
				: 'ADD'
			const res = Reflect.set(target, key, newValue, receiver)
			trigger(target, key, type)
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
			track(target, ITERATE_KEY)
			// 相应的,触发的时候也要从ITERATE_KEY里读取依赖
			return Reflect.ownKeys(target)
		},
		deleteProperty(target, key) {
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

/**
 * will trigger when target[key]-value changed
 * @param {object} target  - same on track
 * @param {string | object} key  - same on track
 * @returns {void}
 */
function trigger(target, key, type) {
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
		const iterateDes = desMap && desMap.get(ITERATE_KEY)
		iterateDes &&
			iterateDes.forEach((fun) => {
				if (activeEffect !== fun) {
					runEffectFunctions.add(fun)
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

// computed
function computed(getter) {
	let value
	let dirty = true
	const effect = registerEffect(getter, {
		// this scheduler function will call be getter internal reactive data changed
		scheduler(effectFun) {
			// effectFun no need run in this scheduler , because we run this function when you get value
			// we just do we want do thing on this scheduler eg: you self code
			if (!dirty) {
				dirty = true
				// we HM call trigger call computed'effect when getter includes reactive value changed
				trigger(obj, 'value')
			}
		},
		lazy: true,
	})

	const obj = {
		get value() {
			if (dirty) {
				value = effect() //这个函数的返回值就是传入的getter函数的返回值,所以computed函数的返回值就是getter函数的返回值,但中间我们做了computed的一些处理(依赖收集)
				dirty = false
				// we HM call track collect computed'effect when computed'value get
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
	const effectFun = registerEffect(
		() => getter() /* 这个getter很有意思,需要经常揣摩 */,
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
		// 因为我们注册的过期函数会在执行下次effect时被调用,所以每次执行的过期回调函数其实是上次watch的回调函数注册的过期回调函数，因为是闭包，所以能记住上次的回调函数的作用域
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
