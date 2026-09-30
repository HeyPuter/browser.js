function GR(w){ return w.location.href }
T("global fn replaced", function(){ Function("GR = function(x){ return x.location.href + '!' }")(); return GR(document) });
T("global fn redeclared", function(){ function L(w){ return w.location.href } function L(w){ return "2" + w.location.href } return L(document) });
