T("tagged", function(){ var w = window; w.tag = function(s){ return this === PW ? "pw" : this === RW ? "rw" : "?" }; return w.tag`x` });
T("method this global", function(){ window.m = function(){ return this === PW ? "pw" : this === RW ? "rw" : "?" }; return window.m() });
T("method this alias", function(){ var w = window; w.m2 = function(){ return this.location.href }; return w.m2() });
