var fs = require('fs');
var tracer = require("tracer").colorConsole();
var mod_url = require('url');
var mod_path = require('path');
var mod_crypto = require('crypto');
var mod_util = require('util');





	// hosts:data.lionhosts[0], // css cdn主机列表
	// image_versions:data.imglist // 数据库图片列表

/**
 * 连接器，处理相对图片路径的各部分，将之拼装为目标格式
 * @param  {[type]} parsed {host,ext,name,version}
 * @return {String}        [description]
 */
function connector(parsed){
	var self = this,
		filelist = self.filelist,
		csspath = parsed.csspath,
		host = parsed.host,
		ext = parsed.ext,
		name = parsed.name,
		version = parsed.version,
		image_versions = this.image_versions || [],
		ret;

	function getVersion(path){
		var r = image_versions.filter(function(row){
			return row.URL === path;
		});

		return r[0] ? r[0]["Version"] : "";
	}

	function inFileList(path){
		return filelist.indexOf(path.substr(1)) !== -1;
	}

	function insideHost(host){
		// this.hosts.indexOf(host)!==-1
		return host.match("static.dp");
	}

	version = getVersion(name+ext);

	// 如果version不存在，且为相对路径
	
	if(parsed.absolute && !insideHost(host)){
		// 若为绝对地址，且该地址为外网地址，将version设置为undefined，代表无需添加版本号
		version = undefined;
	}else{
		if(!version){
			// 检查文件是否存在于文件列表
			// 若存在，记录为需要插入，version为1
			if(inFileList(name+ext)){
				version = 0;
			}else{
			// 否则，抛warning
				tracer.warn(csspath+" : "+name+ext + " 不存在于版本数据库与上线列表");
			}
		}
	}
	

	version = version!==undefined ? ".v"+(version+1) : "";
	ret = "http://" + host+name+version+ext;
	return ret;
}




/**
 * @param {Object} opt
 * @param {String} opt.base css文件的根目录
 * @param {String} opt.host 绝对路径的host地址
 * @param {String} image_version 所有图片文件的结果集，参考DianPing. DP_StaticFileVersion
 */
function CssParser(opt) {
	this.base = opt.base;
	this.filelist = opt.filelist;
	this.connector = opt.connector || connector;
	this._logs = [];
}

CssParser.prototype = {
	log:function(){
		this._logs.forEach(function(lg){
			tracer.info(lg);
		});
		this._logs = [];
	},
	clearlog:function(){
		this._logs = [];
	},
	/**
	 * 分析path下的所有图片路径
	 * 并将相对路径转为绝对路径
	 * @param  {String} path css文件的路径
	 * @return {Object} {changed:Boolean,content:String}
	 */
	parse: function(csspath) {




		var self = this;

		/**
		 * 获取文件内容
		 * @type {String}
		 */
		var content = fs.readFileSync(mod_path.join(this.base,csspath), "utf-8");

		/**
		 * 匹配
		 * 1. url(a.png)
		 * 2. url('http://i1.static.dp/s/c/i/b.png')
		 * 3. url("./c.png")
		 */
		var reg = /url\(\s*(['"]?)([\w\.\/:]+)\1\s*\)/g;

		/**
		 * 用以标识文件是否有修改
		 * 有修改为1，反之为0
		 */
		var changed = 0;

		/**
		 * 返回所有匹配
		 * 例：matches[0] 为 "url(a.png)"
		 */
		var matches = content.match(reg);

		/**
		 * 涉及的所有图片路径
		 * @type {Array}
		 */
		var image_paths = [];

		/**
		 * 判断路径是否为相对路径
		 * 例：  http://i2.static.dp/s/c/i/a.png 返回 true
		 *		c/i/a.png 返回false
		 */

		function isRelative(imgpath) {
			return !/^http:\/\//.test(imgpath);
		}

		/**
		 * 将文件content中的相对地址替换为绝对地址
		 */
		function replaceMatch(match,i) {
			/**
			 * 匹配 url('path/to/image.png')
			 * 中的 path/to/image.png
			 */
			var reg = /\(\s*(['"]?)([\w\.\/:]+)\1\s*\)/,	
				parsed = "",
				imgpath = match.match(reg)[2],
				parsed_url;

			/**
			 * 若非相对路径则取得其相对路径进行parse
			 */
			if(!isRelative(imgpath)){
				parsed = self.calculateImagePath(csspath,imgpath,true);
			}else{
				parsed = self.calculateImagePath(csspath,imgpath);
			}

			image_paths.push((parsed.name+parsed.ext).substr(1));

			parsed_url = "url(" + self.connector(parsed) + ")";

			if(parsed_url !== match){
				self._logs.push(mod_util.format("%s -> %s",match,parsed_url));
				content = content.replace(match, parsed_url);;
				changed = 1;
			}
		}

		/**
		 * 数组去重
		 * @return {[type]} [description]
		 */
		function duplicate(arr){
			var ret = [];
			arr.forEach(function(item){
				if(!ret.some(function(el){
					return item == el;
				})){
					ret.push(item);
				};
			});
			return ret;
		}

		/**
		 * 循环处理所有匹配
		 */
		matches && matches.forEach(replaceMatch);

		return {
			changed: changed,
			content: content,
			image_paths:duplicate(image_paths)
		};
	},

	/**
	 * 计算CDN域名
	 * @param  {[type]} path [description]
	 * @return {[type]}      [description]
	 */
	calculateCDNHost:function(path){
		var md5 = mod_crypto.createHash("md5"),
			hosts = this.hosts,
			count = hosts.length;

		md5.update(path);
		return hosts[parseInt(md5.digest("hex"),16) % count];
	},

	/**
	 * 计算文件的绝对路径
	 * 若:
	 * 1.当前css文件路径为 /s/c/a.css
	 * 2.host为 http://i2.static.dp
	 * 则
	 * 1. i/pic.png -> http://i2.static.dp/s/c/i/pic.png
	 * 2. ./i/pic.png -> http://i2.static.dp/s/i/pic.png
	 * 3. ../pic.png -> http://i2.static.dp/s/pic.png
	 *
	 * 若absolute为true，则忽略csspath
	 */
	calculateImagePath:function(csspath,imgpath,absolute) {
		var host,
			base,
			fullpath,
			url_parsed,
			name,
			version_match,
			version = null,
			reg_with_version = /([\w\/\.]+)(\.v\d+)/,
			ext;

		if(absolute){
			url_parsed = mod_url.parse(imgpath);
			fullpath = url_parsed.pathname;
			host = url_parsed.host;
		}else{
			base = mod_path.dirname(csspath);
			fullpath = "/" + mod_path.join(base,imgpath);
		}

		ext = mod_path.extname(fullpath);

		
		host = (host || this.calculateCDNHost(fullpath));

		name = fullpath.split(ext)[0];
		version_match = name.match(reg_with_version);

		if(version_match){
			version = version_match[2];
			name = version_match[1];
		}

		return {
			csspath:csspath,
			absolute:absolute,
			host:host,
			ext:ext,
			version:version,
			name:name
		};
	}
}


module.exports = CssParser;