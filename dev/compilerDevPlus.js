const TextModes = {
  DATA: 'DATA',
  RCDATA: 'RCDATA',
  RAWTEXT: 'RAWTEXT',
  CDATA: 'CDATA',
}

const TOKEN_TYPE = {
  TAG: 'TAG',
  TAG_END: 'TAG_END',
  TEXT: 'TEXT',
}

const AST_TYPE = {
  ROOT: 'ROOT',
  ELEMENT: 'ELEMENT',
  TEXT: 'TEXT',
}

const JS_AST_TYPE = {
  FunctionDecl: 'FunctionDecl',
  Identifier: 'Identifier',
  RenturnStatement: 'RenturnStatement',
  CallExpression: 'CallExpression',
  StringLiteral: 'StringLiteral',
  ArrayExpression: 'ArrayExpression',
}

function parse(str) {
  const context = {
    source: str,
    mode: TextModes.DATA,
    advanceBy(num) {
      context.source = context.source.slice(num)
    },
    advanceSpaces() {
      /* 匹配开头的所有字符,不会影响在中间穿插的空白字符 */
      const match = /^[\t\r\n\f ]+/.exec(context.source)
      if (match) {
        context.advanceBy(match[0])
      }
    },
  }
  const nodes = parseChildren(context, [] /* 节点栈 */)
  return {
    type: AST_TYPE.ROOT,
    children: nodes,
  }
}

/* ancestors父级节点栈,这里面有当前节点的所有父元素,栈顶(最近的一个父元素)就是自己的父元素 */
function isEnd(context, ancestors) {
  if (!context.source) {
    // 模板字符串被消费完毕了
    return true
  }
  for (let i = 0; i < ancestors.length; i++) {
    if (context.source.startsWith(`</${ancestors[i].tag}`)) {
      return true
    }
  }
}
// const template = `<div>
//   <p>Text1</p>
//   <p>Text2</p>
// </div>` 因为在解析模板时不能忽略空白字符(换行符\n,回车符\r,空格 ,制表符\t和换页符\f)
// 用+表示换行符,-表示空格:
// const template = `<div>+--<p>Text1</p>+--<p>Text2</p>+</div>`
function parseChildren(context, ancestors) {
  const nodes = []
  const { source, mode } = context
  while (!isEnd(context, ancestors)) {
    let node = null
    if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
      if (mode === TextModes.DATA && source[0] === '<') {
        if (source[1] === '!') {
          // 可能是是注释节点<!--(在html中的注释节点)或者![CDATA[节点
          if (source.startsWith('<!--')) {
            // 注释节点
            node = parseComment(context)
          } else if (source.startsWith('![CDATA[')) {
            // 是![CDATA[节点
            node = parseCDATA(context, ancestors)
          }
        } else if (source[1] === '/') {
          /*第一种解释: 在状态机没有停止(栈顶不是自己的父节点)的情况下遇到了结束标签,说明这
          个结束标签不是与自己对应的,例如:<div><span></div></span>,在这种情况下,
          处理到</结束标签时的栈顶父节点是span,而不是div,所以状态机不会停止,所以
          在状态机不停止的情况下遇到了结束标签,就说明html结构出现了问题,需要报错
          提示用户修改结构 */
          /* 第二种解释:将<div><span></div>作为一个完整的父子节点结构,而</span>
          会被认为是多余的,不会处理它,在这种情况下就可以提示用户<span>标签没有闭
          合标签,这样一来错误的提示就更完整了,我们采用第二种解释,所以需要修改
          isEnd的逻辑,在寻找父节点时应该从父节点栈中找,而不只是从栈顶寻找,这样就
          可以找到</div>的开始标签,就可以停止状态机 */
          console.error('无效的结束标签')
        } else if (/[a-z]/i.test(source[1])) {
          // 标签
          node = parseElement(context, ancestors)
        }
      } else if (source.startsWith('{{')) {
        // 插值节点
        node = parseInterpolateion(context)
      }
    }
    if (!node) {
      // 如果以上情况都没有匹配,那就当做文本节点处理
      node = parseText(context)
    }
    nodes.push(node)
  }
  return nodes
}
const RCDATA_REGEXP = /textarea|title/
const RAWTEXT_REGEXP = /style|xmp|iframe|noembed|noifames|noscript/
function parseElement(context, ancestors) {
  const element = parseTag(context)
  if (element.isSelfClosing) {
    /* 自闭合节点没有子节点,不需要处理有子节点的情况,也就不需要把自己添加到父节点栈中 */
    return element
  }
  if (RCDATA_REGEXP.test(element.tag)) {
    context.mode = TextModes.RCDATA
  } else if (RAWTEXT_REGEXP.test(element.tag)) {
    context.mode = TextModes.RAWTEXT
  } else {
    context.mode = TextModes.DATA
  }
  ancestors.push(element)
  element.children = parseChildren(context, ancestors) /* 递归处理子节点 */
  ancestors.pop()
  if (context.source.startsWith(`</${element.tag}`)) {
    parseTag(context, 'end')
  } else {
    // 如果当前元素的子节点处理完毕后的下一个字符不是以'</自己的标签名'开头的,
    // 那就说明html文档结构编写错误,需要提示用户
    console.error(`${element.tag} 标签缺少闭合标签`)
  }
  return element
}

function parseTag(context, type = 'start') {
  const { advanceBy, advanceSpaces } = context
  const match =
    type === 'start'
      ? /^<([a-z][^\t\r\n\f />]*)/i.exec(context.source) /* 匹配开始标签(当type为start时) */
      : /^<\/([a-z][^\t\r\n\f />]*)/i.exec(context.source) /* 匹配结束标签(当type为end时) */
  /* 正则表达式解释:
      开始标签匹配成功条件: 必须由'<'字符开始,然后在字母a-z中最少有一个并且不能有\t\r\n\f等空白字符,空格( )以及/和>
      结束标签匹配成功条件: 必须由'</'字符开始,然后在字母a-z中最少有一个并且不能有\t\r\n\f等空白字符,空格( )以及/和>
  */
  console.log(match)
  const tag = match[1] /* 匹配结果的第一项,也就是去除开始字符'<'后的匹配结果,就是标签名称 */
  advanceBy(match[0]) /* 消费所有的匹配结果,即包含开始字符<div */
  advanceSpaces() /* 去除空白字符 */
  /* <span/> 在消费完匹配结果<span后还剩下/>,如果紧接着的就是/>说明这是一个自闭合标签 */
  const isSelfClosing = context.source.startsWith('/>')
  /* 自闭合标签需要消费'/'和'>'两个字符,普通标签只需要消费'>'一个字符 */
  advanceBy(isSelfClosing ? 2 : 1)
  return {
    type: AST_TYPE.ELEMENT,
    tag,
    props: [],
    children: [],
    isSelfClosing,
  }
}
