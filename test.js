let settings = {
	url: 'https://api.binjie.fun/api/generateStream?refer__1360=eqRxRDyD9QY4cDBqDTjOIE47KeGKqPx',
	method: 'POST',
	timeout: 0,
	headers: {
		'Origin': 'https://chat18.aichatos8.com',
		'Referer': 'https://chat18.aichatos8.com/',
		'User-Agent': 'Apifox/1.0.0 (https://apifox.com)',
		'Content-Type': 'application/json',
		'Accept': '*/*',
		'Host': 'api.binjie.fun',
		'Connection': 'keep-alive',
		'Content-Length': '148',
		'Cookie':
			'acw_tc=76b4389d17202721112287897ef3e9c994d20b3dd5afbb002fca4c8ef0; cdn_sec_tc=76b4389d17202721112287897ef3e9c994d20b3dd5afbb002fca4c8ef0',
	},
	data: JSON.stringify({
		network: false,
		prompt: '用JavaScript写一个冒泡排序',
		stream: false,
		system: '',
		userId: '#/chat/1717330797116',
		withoutContext: false,
	}),
}

function setPrompt(prompt) {
	settings.data = JSON.stringify({
		network: false,
		prompt: prompt,
		stream: false,
		system: '',
		userId: '#/chat/1717330797116',
		withoutContext: false,
	})
}

const msgSpanDom = document.querySelector('.msg')
const promptInputDom = document.querySelector('.prompt')
promptInputDom.addEventListener('change', async (e) => {
	const prompt = e.target.value
	console.log(e.target.value)
	setPrompt(prompt)
	msgSpanDom.textContent = '加载中~'
	const response = await $.ajax(settings)
	console.log(response)
	msgSpanDom.textContent = response
})
