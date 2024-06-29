const data = { foo: 1, bar: 2 }
const data2 = { name: 'xygod', email: '1323943635@qq.com' }

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
		cleanup(runEffect)
		activeEffect = runEffect
		effectStack.push(runEffect)
		const res = wantRegisterEffectFunction()
		effectStack.pop()
		activeEffect = effectStack[effectStack.length - 1]
		return res
	}
	runEffect.deps = []
	runEffect.options = options
	if (!options.lazy) {
		runEffect()
	} else {
		if (options.who) console.log(options.who, options.lazy)
	}
	return runEffect
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
	// 将依赖集合添加到deps中
	activeEffect.deps.push(des)
}

/**
 * will trigger when target[key]-value changed
 * @param {object} target  - same on track
 * @param {string | object} key  - same on track
 * @returns {void}
 */
function trigger(target, key) {
	let desMap = bucket.get(target)
	let des = desMap && desMap.get(key)
	const runEffectFunctions = new Set()
	des &&
		des.forEach((fun) => {
			if (activeEffect !== fun) {
				runEffectFunctions.add(fun)
			}
		})
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
				value = effect()
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
 *  call getter to track depends
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
	const effectFun = registerEffect(() => getter(), {
		lazy: true,
		who: 'watch',
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
let finalData
watch(
	() => reactive_obj2.name,
	// HOW 回调函数在每次执行的时候都会新开一个作用域,每次函数执行时的作用域是不同的,不能一概而论
	async (newValue, oldValue, onInvalidate) => {
		let expired = false
		onInvalidate(() => {
			expired = true
		})
		const res = await new Promise((resolve, reject) => {
			setTimeout(() => {
				resolve('data')
			}, 1000)
		})
		if (!expired) {
			finalData = res
		}
		console.log('reactive_obj2改变了', newValue, oldValue)
	},
	{
		immediate: false,
		flush: 'post',
	}
)
// reactive_obj2
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
const effect = registerEffect(
	() => {
		// console.log(reactive_obj.foo)
	},
	{
		// scheduler(effectFun) {
		// 	jobQueue.add(effectFun)
		// 	flushJob()
		// },
		lazy: true,
		who: 'test',
	}
)
const effectValue = effect()

// reactive_obj.foo++
// reactive_obj.foo++

const sum = computed(() => {
	console.log('sum read')
	// reactive_obj.bar and reactive_obj.foo will collect this effectFun , when they value changed ,the function will be call
	return reactive_obj.bar + reactive_obj.foo
})

//if we no handle this case( trigger(obj, 'value'):137 and track(obj, 'value'):148 ) , the will not work,
//because computed has own effectFun and this effectFun call with get value, and computed'getter only collect computed internal effect because we do this,
//that good in general,but in this case , we want computed'effect( function(){console.log(sum.value)} ) can be call when computed'getter includes reactive value changed,
//in this case,we need HM track and trigger computed'effect when computed'get call track and computed includes reactive value changed call trigger (on computed internal effect , we can call trigger(obj,"value") -- obj is we define local variable and value is obj value attribute , if you want , you can eval define you_name_obj and you_name_value)
registerEffect(() => {
	console.log(sum.value)
})

reactive_obj.bar++
reactive_obj.bar++
reactive_obj.bar++
