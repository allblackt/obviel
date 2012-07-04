/*global jQuery: false, alert: false, obviel: false, _: false */
/*jshint white: false, browser: true, onevar: false, undef: true,
eqeqeq: true, plusplus: false, bitwise: true, regexp: true, newcap: true,
immed: true, strict: false, maxlen: 80, maxerr: 9999 */

var traject = {};

(function($, module) {
    var UNCONVERTED = {};
    
    traject.ParseError = function (message) {
        this.message = message;
    };
    
    traject.ResolutionError = function (message) {
        this.message = message;
    };

    traject.LocationError = function (message) {
        this.message = message;
    };

    traject.RegistrationError = function (message) {
        this.message = message;
    };
    
    var normalize = function (patternStr) {
        if (patternStr.charAt(0) === '/') {
            return patternStr.slice(1);
        }
        return patternStr;
    };

    var parse = traject.parse = function (patternStr) {
        patternStr = normalize(patternStr);
        var pattern = patternStr.split('/');
        var knownVariables = {};
        for (var i in pattern) {
            var step = pattern[i];
            if (step.charAt(0) === '$') {
                if (knownVariables[step] !== undefined) {
                    throw new traject.ParseError(
                        "URL pattern contains multiple variables with name: " +
                            step.slice(1));
                }
                knownVariables[step] = true;
            }
        }
        return pattern;
    };

    var subpatterns = traject.subpatterns = function (pattern) {
        var subpattern = [];
        var result = [];
        for (var i in pattern) {
            var step = pattern[i];
            subpattern.push(step);
            result.push(subpattern.slice(0));
        }
        return result;
    };
    
    var generalizePattern = function (pattern) {
        var result = [];
        for (var i in pattern) {
            var p = pattern[i];
            if (p.charAt(0) === '$') {
                result.push('$');
            } else {
                result.push(p);
            }
        }
        return result;
    };

    var componentName = function (pattern) {
        return generalizePattern(pattern).join('/');
    };
    
    var convertString = function (s) {
        return s.toString();
    };

    var convertInteger = function (s) {
        var result = parseInt(s, 10);
        if (isNaN(result)) {
            return UNCONVERTED;
        }
        return result;
    };

    traject.Patterns = function () {
        this._stepRegistry = {};
        this._lookupRegistry = {};
        // XXX interface inheritance isn't done
        this._inverseRegistry = {};
        this._converters = {
            'str': convertString,
            'int': convertInteger
        };
        this._defaultLookup = function () {
            return {iface: 'default'};
        };
    };
    
    traject.Patterns.prototype.registerConverter = function (converterName,
                                                              converterFunc) {
        this._converters[converterName] = converterFunc;
    };

    var _dummy = {};
    
    traject.Patterns.prototype.register = function (
        patternStr, lookup) {
        var pattern = parse(patternStr);
        var sp = subpatterns(pattern);
        var p = null;
        var name = null;
        for (var i in sp) {
            p = sp[i];
            name = componentName(p);
            var value = null;
            if (name.charAt(name.length - 1) === '$') {
                value = p[p.length - 1].slice(1);
                if (value.indexOf(':') !== -1) {
                    var valueParts = value.split(':');
                    var converterName = valueParts[1];
                    if (this._converters[converterName] === undefined) {
                        throw new traject.RegistrationError(
                            "Could not register " + pattern.join('/') +
                            " because no converter can be found for " +
                            "variable " + value);
                    }
                }
                var prevValue = this._stepRegistry[name];
                if (prevValue === value) {
                    continue;
                }
                if (prevValue !== undefined) {
                    throw new traject.RegistrationError(
                        "Could not register " + pattern.join('/') +
                        "because of a conflict between variable " +
                        value + " and already registered " + prevValue);
                }
                
            } else {
                value = _dummy;
            }
            this._stepRegistry[name] = value;
        }
        p = sp[sp.length - 1];
        name = componentName(p);
        this._lookupRegistry[name] = lookup;
    };

    traject.Patterns.prototype.registerInverse = function (
        iface, patternStr, inverse) {
        this._inverseRegistry[iface] = {
            pattern: parse(patternStr),
            inverse: inverse
        };
    };

    traject.Patterns.prototype.pattern = function (
        iface, patternStr, lookup, inverse) {
        this.register(patternStr, lookup);
        this.registerInverse(iface, patternStr, inverse);
    };
    
    traject.Patterns.prototype.setDefaultLookup = function (f) {
        this._defaultLookup = f;
    };

    traject.Patterns.prototype.resolve = function (root, path) {
        path = normalize(path);
        var names = path.split('/');
        names.reverse();
        return this.resolveStack(root, names);
    };

    traject.Patterns.prototype.resolveStack = function (root, stack) {
        var r = this.consumeStack(root, stack);
        if (r.unconsumed.length) {
            var stackCopy = stack.slice(0);
            stackCopy.reverse();
            throw new traject.ResolutionError("Could not resolve path: " +
                                              stackCopy.join('/'));
        }
        return r.obj;
    };

    traject.Patterns.prototype.consume = function (root, path) {
        path = normalize(path);
        var names = path.split('/');
        names.reverse();
        return this.consumeStack(root, names);
    };

    var providedBy = function (obj) {
        if (obj.ifaces !== undefined) {
            return obj.ifaces[0]; // XXX this a hack
        }
        return obj.iface;
    };
    
    traject.Patterns.prototype.consumeStack = function (root, stack) {
        var variables = {};
        var obj = root;
        var pattern = [];
        var consumed = [];
        while (stack.length) {
            var name = stack.pop();
            var stepPattern = pattern.concat(name);
            var stepPatternStr = stepPattern.join('/');
            var nextStep = this._stepRegistry[stepPatternStr];
            
            var patternStr = null;
            
            if (nextStep !== undefined) {
                pattern = stepPattern;
                patternStr = stepPatternStr;
            } else {
                var variablePattern = pattern.concat('$');
                var variablePatternStr = variablePattern.join('/');
                var variable = this._stepRegistry[variablePatternStr];
                if (variable !== undefined) {
                    pattern = variablePattern;
                    patternStr = variablePatternStr;
                    var converterName = null;
                    if (variable.indexOf(':') !== -1) {
                        var l = variable.split(':');
                        variable = l[0];
                        converterName = l[1];
                    } else {
                        converterName = 'str';
                    }
                    var converter = this._converters[converterName];
                    var converted = converter(name);
                    if (converted === UNCONVERTED) {
                        stack.push(name);
                        return {unconsumed: stack, consumed: consumed,
                                obj: obj};
                    }
                    variables[variable.toString()] = converted;
                } else {
                    stack.push(name);
                    return {unconsumed: stack, consumed: consumed,
                            obj: obj};
                }
            }
            var lookup = this._lookupRegistry[patternStr];
            if (lookup === undefined) {
                lookup = this._defaultLookup;
            }
            var parent = obj;
            obj = lookup(variables);
            if (obj === null || obj === undefined) {
                stack.push(name);
                return {unconsumed: stack, consumed: consumed, obj: parent};
            }
            consumed.push(name);
            obj.trajectName = name;
            obj.trajectParent = parent;
        }
        return {unconsumed: stack, consumed: consumed, obj: obj};
    };

    traject.Patterns.prototype.locate = function (root, obj) {
        if (obj.trajectParent !== undefined &&
            obj.trajectParent !== null) {
            return;
        }

        var iface = providedBy(obj);

        var v = this._inverseRegistry[iface];
        if (v === undefined) {
            throw new traject.LocationError(
                "Cannot reconstruct parameters of: " +
                providedBy(obj));
        }
        /* need to make a copy of pattern before manipulating it */
        var pattern = v.pattern.slice(0);
        var inverse = v.inverse;

        var genPattern = generalizePattern(pattern);

        var variables = inverse(obj);

        if (variables === null || variables === undefined) {
            throw new traject.LocationError(
                "Inverse returned null or undefined, not variables");
        }
        
        for (var key in variables) {
            var value = variables[key];
            variables[key.toString()] = value;
        }
        
        while (true) {
            var name = pattern.pop();
            var genName = genPattern.pop();

            if (genName === '$') {
                name = name.slice(1);
                if (name.indexOf(':') !== -1) {
                    var p = name.split(':');
                    name = p[0];
                    var converterName = p[1];
                }
                name = variables[name];
                delete variables[name];
            }
            obj.trajectName = name.toString();

            if (genPattern.length === 0) {
                obj.trajectParent = root;
                return;
            }
            var lookup = this._lookupRegistry[genPattern.join('/')];

            if (lookup === undefined) {
                lookup = this._defaultLookup;
            }
            var parent = lookup(variables);
            obj.trajectParent = parent;
            obj = parent;

            if (obj.trajectParent !== undefined &&
                obj.trajectParent !== null) {
                return;
            }
        }
    
    };

    traject.Patterns.prototype.path = function(root, obj) {
        this.locate(root, obj);
        var stack = [];
        while (obj !== root) {
            stack.push(obj.trajectName);
            obj = obj.trajectParent;
        }

        stack.reverse();
        return stack.join('/');
    };
}(jQuery, traject));
