class Count {
	limit = 1
	count = 1
	constructor(limit) {
		this.limit = limit
	}
	next() {
		if (this.count <= this.limit) {
			return { done: false, value: this.count++ }
		} else {
			return { done: true, value: undefined }
		}
	}
	[Symbol.iterator]() {
		return this
	}
}

const count = new Count(3)
console.log(count)

for (let key in count) {
	console.log(key)
}
for (let i of count) {
	console.log(i)
}
;(function (a) {
	console.log(a)
})({})
