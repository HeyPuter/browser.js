T("this computed", function(){ var w = window; w.m4 = function(k){ return this[k].href }; return w.m4("location") });
T("this return", function(){ var w = window; w.m6 = function(){ return this }; return w.m6().location.href });
T("this nested arrow deep", function(){ var w = window; w.m8 = function(){ return (() => () => this["loc" + "ation"].href)()() }; return w.m8() });
T("this compare", function(){ var d = document; var r; d.dispatchReal(function(){ r = this === document }); return r });
T("this class method", function(){ class C { m() { return this.location.href } } var w = window; w.cm = C.prototype.m; return w.cm() });
T("this call receiver class", function(){ class K { m() { return this.location.href } } var w = window; w.cc = function(){ return K.prototype.m.call(this) }; return w.cc() });
T("this custom call method", function(){ var o = { call(x){ return x.location.href } }; var w = window; w.cm2 = function(){ return o.call(this) }; return w.cm2() });
T("null proto location", function(){ var o = Object.create(null); o.location = { href: "np" }; var d = document; d = o; return d.location.href });
