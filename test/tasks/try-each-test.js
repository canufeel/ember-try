'use strict';

var expect          = require('chai').expect;
var tmp             = require('tmp-sync');
var path            = require('path');
var RSVP            = require('rsvp');
var fs              = require('fs-extra');
var fixtureBower    = require('../fixtures/bower.json');
var fixturePackage  = require('../fixtures/package.json');
var fixtureYarn     = fs.readFileSync(path.join(__dirname, '../fixtures/yarn.lock'), 'utf8');
var writeJSONFile   = require('../helpers/write-json-file');
var mockery         = require('mockery');

/* Some of the tests in this file intentionally DO NOT stub dependency manager adapter*/
var StubDependencyAdapter = require('../helpers/stub-dependency-manager-adapter');
var generateMockRun       = require('../helpers/generate-mock-run');

var remove  = RSVP.denodeify(fs.remove);
var root    = process.cwd();
var tmproot = path.join(root, 'tmp');
var tmpdir;

var legacyConfig = {
  scenarios: [
    {
      name: 'default',
      dependencies: {}
    },
    {
      name: 'first',
      dependencies: {
        ember: '1.13.0'
      }
    },
    {
      name: 'second',
      dependencies: {
        ember: '2.0.0'
      }
    },
    {
      name: 'with-dev-deps',
      dependencies: {
        ember: '2.0.0'
      },
      devDependencies: {
        jquery: '1.11.3'
      }
    },
    {
      name: 'with-resolutions',
      dependencies: {
        ember: 'components/ember#beta'
      },
      resolutions: {
        ember: 'beta'
      }
    }
  ]
};

const getConfig = (type) => ({
  scenarios: [
    {
      name: 'first',
      bower: {
        dependencies: {
          ember: '1.13.0',
          bootstrap: null
        }
      },
      [type]: {
        dependencies: {
          'ember-cli-deploy': '0.5.0'
        }
      }
    }, {
      name: 'second',
      bower: {
        dependencies: {
          ember: '2.0.0'
        },
        devDependencies: {
          jquery: '1.11.3'
        }
      },
      [type]: {
        devDependencies: {
          'ember-cli-deploy': '0.5.1'
        }
      }
    },
    {
      name: 'with-bower-resolutions',
      bower: {
        dependencies: {
          ember: 'components/ember#beta'
        },
        resolutions: {
          ember: 'beta'
        }
      },
      [type]: {
        dependencies: {
          'ember-cli-deploy': '0.5.1'
        }
      }
    }
  ]
});

function setupMockedRunSuccess() {
  this.timeout(300000);

  let mockedRun = generateMockRun('ember test', function() {
    return RSVP.resolve(0);
  });

  mockery.registerMock('./run', mockedRun);
}

function setupTryEach(tryEachParams, mockedExitCallback) {
  let output = [];
  let outputFn = function(log) {
    output.push(log);
  };

  let mockedExit;
  if (mockedExitCallback) {
    mockedExit = mockedExitCallback;
  } else {
    mockedExit = function(code) {
      expect(code).to.equal(0, 'exits 0 when all scenarios succeed');
    };
  }

  let TryEachTask = require('../../lib/tasks/try-each');
  let tryEachConf = {
    ui: {writeLine: outputFn},
    project: {root: tmpdir},
    _on: function() {},
    _exit: mockedExit
  };

  let keys = Object.keys(tryEachParams);
  keys.forEach(function(key) {
    tryEachConf[key] = tryEachParams[key];
  });

  let tryEachTask = new TryEachTask(tryEachConf);
  return {
    output: output,
    tryEachTask: tryEachTask
  };
}

function setupForSuccess(tryEachParams, mockedExitCallback) {
  setupMockedRunSuccess.call(this);
  return setupTryEach(tryEachParams, mockedExitCallback);
}

function setupForFail(tryEachParams) {
  this.timeout(300000);

  let runTestCount = 0;
  let mockedRun = generateMockRun('ember test', function() {
    runTestCount++;
    if (runTestCount === 1) {
      return RSVP.reject(1);
    } else {
      return RSVP.resolve(0);
    }
  });

  mockery.registerMock('./run', mockedRun);

  let mockedExitCallback = function(code) {
    expect(code).to.equal(1);
  };
  return setupTryEach(tryEachParams, mockedExitCallback);
}

function npmFileSetup() {
  writeJSONFile('package.json', fixturePackage);
  fs.mkdirSync('node_modules');
  writeJSONFile('bower.json', fixtureBower);
}

function yarnFileSetup() {
  writeJSONFile('package.json', fixturePackage);
  fs.mkdirSync('node_modules');
  writeJSONFile('bower.json', fixtureBower);
  fs.writeFileSync('yarn.lock', fixtureYarn);
}

function catchErrorLog(err) {
  console.log(err);
  expect(true).to.equal(false, 'Assertions should run');
}

function expectSuccess(output) {
  expect(output).to.include('Scenario first: SUCCESS');
  expect(output).to.include('Scenario second: SUCCESS');
  expect(output).to.include('Scenario with-bower-resolutions: SUCCESS');
  expect(output).to.include('All 3 scenarios succeeded');
}

function expectFail(output) {
  expect(output).to.include('Scenario first: FAIL');
  expect(output).to.include('Scenario second: SUCCESS');
  expect(output).to.include('Scenario with-bower-resolutions: SUCCESS');
  expect(output).to.include('1 scenarios failed');
  expect(output).to.include('2 scenarios succeeded');
  expect(output).to.include('3 scenarios run');
}

describe('tryEach', function() {
  beforeEach(function() {
    tmpdir = tmp.in(tmproot);
    process.chdir(tmpdir);
    mockery.enable({
      warnOnUnregistered: false,
      useCleanCache: true
    });
    require('chalk').enabled = false;
  });

  afterEach(function() {
    mockery.deregisterAll();
    mockery.disable();
    process.chdir(root);
    return remove(tmproot);
  });

  describe('with legacy config', function() {
    it('succeeds when scenario\'s tests succeed', function() {

      let setupResult = setupForSuccess.call(this, {config: legacyConfig});
      let output = setupResult.output;
      let tryEachTask = setupResult.tryEachTask;

      writeJSONFile('bower.json', fixtureBower);
      return tryEachTask.run(legacyConfig.scenarios, {}).then(function() {
        expect(output).to.include('Scenario default: SUCCESS');
        expect(output).to.include('Scenario first: SUCCESS');
        expect(output).to.include('Scenario second: SUCCESS');
        expect(output).to.include('Scenario with-dev-deps: SUCCESS');
        expect(output).to.include('Scenario with-resolutions: SUCCESS');

        expect(output).to.include('All 5 scenarios succeeded');
      }).catch(catchErrorLog);
    });


    it('fails scenarios when scenario\'s tests fail', function() {

      let setupResult = setupForFail.call(this, {config: legacyConfig});
      let output = setupResult.output;
      let tryEachTask = setupResult.tryEachTask;

      writeJSONFile('bower.json', fixtureBower);
      return tryEachTask.run(legacyConfig.scenarios, {}).then(function() {
        expect(output).to.include('Scenario default: FAIL');
        expect(output).to.include('Scenario first: SUCCESS');
        expect(output).to.include('Scenario second: SUCCESS');
        expect(output).to.include('Scenario with-dev-deps: SUCCESS');
        expect(output).to.include('Scenario with-resolutions: SUCCESS');
        expect(output).to.include('1 scenarios failed');
        expect(output).to.include('4 scenarios succeeded');
        expect(output).to.include('5 scenarios run');
      }).catch(catchErrorLog);
    });

  });

  describe('with both npm and bower', function() {
    it('succeeds when scenario\'s tests succeed', function() {
      let config = getConfig('npm');
      let setupResult = setupForSuccess.call(this, {config});
      let output = setupResult.output;
      let tryEachTask = setupResult.tryEachTask;

      npmFileSetup();

      return tryEachTask.run(config.scenarios, {}).then(function() {
        expectSuccess(output);
      }).catch(catchErrorLog);
    });


    it('fails scenarios when scenario\'s tests fail', function() {
      let config = getConfig('npm');
      let setupResult = setupForFail.call(this, {config});
      let output = setupResult.output;
      let tryEachTask = setupResult.tryEachTask;

      npmFileSetup();
      return tryEachTask.run(config.scenarios, {}).then(function() {
        expectFail(output);
      }).catch(catchErrorLog);
    });

    it('displays proper package version information', function() {
      let config = getConfig('npm');
      let mockedPrintResults = function(results) {
        results.forEach((result) => {
          let state = result.dependencyState;
          state.forEach((pkg) => {
            if (pkg.name != 'ember') {
              expect(pkg.versionExpected).to.equal(pkg.versionSeen);
            }
          });
        })
      };

      let setupResult = setupForSuccess.call(this, {
        config: config,
        _printResults: mockedPrintResults
      });
      let tryEachTask = setupResult.tryEachTask;

      npmFileSetup();

      return tryEachTask.run(config.scenarios, {}).catch(catchErrorLog);

    });

  });

  describe('with both yarn and bower', function() {
    it('succeeds when scenario\'s tests succeed', function() {
      let config = getConfig('yarn');
      let setupResult = setupForSuccess.call(this, {config});
      let output = setupResult.output;
      let tryEachTask = setupResult.tryEachTask;

      yarnFileSetup();

      return tryEachTask.run(config.scenarios, {}).then(function() {
        expectSuccess(output);
      }).catch(catchErrorLog);
    });


    it('fails scenarios when scenario\'s tests fail', function() {
      let config = getConfig('yarn');
      let setupResult = setupForFail.call(this, {config});
      let output = setupResult.output;
      let tryEachTask = setupResult.tryEachTask;

      yarnFileSetup();

      return tryEachTask.run(config.scenarios, {}).then(function() {
        expectFail(output);
      }).catch(catchErrorLog);
    });

    it('displays proper package version information', function() {
      let config = getConfig('yarn');
      let mockedPrintResults = function(results) {
        results.forEach(function(result) {
          let state = result.dependencyState;
          state.forEach(function(pkg) {
            if (pkg.name != 'ember') {
              expect(pkg.versionExpected).to.equal(pkg.versionSeen);
            }
          });
        })
      };

      let setupResult = setupForSuccess.call(this, {
        config,
        _printResults: mockedPrintResults
      });
      let tryEachTask = setupResult.tryEachTask;

      yarnFileSetup();

      return tryEachTask.run(config.scenarios, {}).catch(catchErrorLog);

    });

  });

  describe('with stubbed dependency manager', function() {
    it('passes along timeout options to run', function() {
      // With stubbed dependency manager, timing out is warning for accidentally not using the stub
      this.timeout(1200);

      var config = {
        scenarios: [{
          name: 'first',
          dependencies: {
            ember: '1.13.0'
          }
        }]
      };
      var passedInOptions = false;
      var mockedRun = generateMockRun('ember serve', function(command, args, options) {
        if (options.timeout && options.timeout.length === 20000 && options.timeout.isSuccess) {
          passedInOptions = true;
        }
        return RSVP.resolve(0);
      });

      mockery.registerMock('./run', mockedRun);

      var setupResult = setupTryEach.call(this, {
        config: config,
        commandArgs: ['ember', 'serve'],
        commandOptions: { timeout: { length: 20000, isSuccess: true }},
        dependencyManagerAdapters: [new StubDependencyAdapter()]
      });
      var output = setupResult.output;
      var tryEachTask = setupResult.tryEachTask;

      writeJSONFile('bower.json', fixtureBower);
      return tryEachTask.run(config.scenarios, {}).then(function() {
        expect(output).to.include('Scenario first: SUCCESS');
        expect(passedInOptions).to.equal(true, 'Should pass the options all the way down to run');
      }).catch(catchErrorLog);
    });

    describe('allowedToFail', function() {
      it('exits appropriately if all failures were allowedToFail', function() {
        // With stubbed dependency manager, timing out is warning for accidentally not using the stub
        this.timeout(1200);

        var config = {
          scenarios: [{
            name: 'first',
            allowedToFail: true,
            dependencies: {
              ember: '1.13.0'
            }
          },{
            name: 'second',
            allowedToFail: true,
            dependencies: {
              ember: '2.2.0'
            }
          }]
        };

        var mockedRun = generateMockRun('ember test', function() {
          return RSVP.reject(1);
        });
        mockery.registerMock('./run', mockedRun);

        var exitCode;
        var mockedExit = function(code) {
          exitCode = code;
        };

        let setupResult = setupTryEach.call(this, {
          config,
          dependencyManagerAdapters: [new StubDependencyAdapter()]
        }, mockedExit);
        let output = setupResult.output;
        let tryEachTask = setupResult.tryEachTask;

        return tryEachTask.run(config.scenarios, {}).then(function() {
          expect(output).to.include('Scenario first: FAIL (Allowed)');
          expect(output).to.include('Scenario second: FAIL (Allowed)');
          expect(output).to.include('2 scenarios failed (2 allowed)');
          expect(exitCode).to.equal(0, 'exits 0 when all failures were allowed');
        }).catch(catchErrorLog);
      });

      it('exits appropriately if any failures were not allowedToFail', function() {
        // With stubbed dependency manager, timing out is warning for accidentally not using the stub
        this.timeout(1200);

        var config = {
          scenarios: [{
            name: 'first',
            dependencies: {
              ember: '1.13.0'
            }
          },{
            name: 'second',
            allowedToFail: true,
            dependencies: {
              ember: '2.2.0'
            }
          }]
        };

        var mockedRun = generateMockRun('ember test', function() {
          return RSVP.reject(1);
        });
        mockery.registerMock('./run', mockedRun);

        var exitCode;
        var mockedExit = function(code) {
          exitCode = code;
        };

        let setupResult = setupTryEach.call(this, {
          config,
          dependencyManagerAdapters: [new StubDependencyAdapter()]
        }, mockedExit);
        let output = setupResult.output;
        let tryEachTask = setupResult.tryEachTask;

        return tryEachTask.run(config.scenarios, {}).then(function() {
          expect(output).to.include('Scenario first: FAIL');
          expect(output).to.include('Scenario second: FAIL (Allowed)');
          expect(output).to.include('2 scenarios failed (1 allowed)');
          expect(exitCode).to.equal(1, 'exits 1 when any failures were NOT allowed');
        }).catch(catchErrorLog);
      });

      it('exits appropriately if all allowedToFail pass', function() {
        // With stubbed dependency manager, timing out is warning for accidentally not using the stub
        this.timeout(1200);

        var config = {
          scenarios: [{
            name: 'first',
            allowedToFail: true,
            dependencies: {
              ember: '1.13.0'
            }
          },{
            name: 'second',
            allowedToFail: true,
            dependencies: {
              ember: '2.2.0'
            }
          }]
        };

        var mockedRun = generateMockRun('ember test', function() {
          return RSVP.resolve(0);
        });
        mockery.registerMock('./run', mockedRun);

        var exitCode;
        var mockedExit = function(code) {
          exitCode = code;
        };

        let setupResult = setupTryEach.call(this, {
          config,
          dependencyManagerAdapters: [new StubDependencyAdapter()]
        }, mockedExit);
        let output = setupResult.output;
        let tryEachTask = setupResult.tryEachTask;

        return tryEachTask.run(config.scenarios, {}).then(function() {
          expect(output).to.include('Scenario first: SUCCESS');
          expect(output).to.include('Scenario second: SUCCESS');
          expect(output).to.include('All 2 scenarios succeeded');
          expect(exitCode).to.equal(0, 'exits 0 when all pass');
        }).catch(catchErrorLog);
      });

    });

    describe('configurable command', function() {
      it('defaults to `ember test`', function() {
        // With stubbed dependency manager, timing out is warning for accidentally not using the stub
        this.timeout(1200);

        var config = {
          scenarios: [{
            name: 'first',
            dependencies: {
              ember: '1.13.0'
            }
          },{
            name: 'second',
            dependencies: {
              ember: '2.2.0'
            }
          }]
        };

        var ranDefaultCommand = false;

        var mockedRun = generateMockRun('ember test', function() {
          ranDefaultCommand = true;
          return RSVP.resolve(0);
        });

        mockery.registerMock('./run', mockedRun);

        let setupResult = setupTryEach.call(this, {
          config,
          commandArgs: [],
          dependencyManagerAdapters: [new StubDependencyAdapter()]
        });
        let output = setupResult.output;
        let tryEachTask = setupResult.tryEachTask;

        return tryEachTask.run(config.scenarios, {}).then(function() {
          expect(output).to.include('Scenario first: SUCCESS');
          expect(output).to.include('Scenario second: SUCCESS');

          expect(ranDefaultCommand).to.equal(true, 'Should run the default command');
        }).catch(catchErrorLog);
      });

      it('allows passing in of the command to run', function() {
        // With stubbed dependency manager, timing out is warning for accidentally not using the stub
        this.timeout(1200);

        var config = {
          command: 'ember test-this',
          scenarios: [{
            name: 'first',
            dependencies: {
              ember: '1.13.0'
            }
          }]
        };
        var ranPassedInCommand = false;
        var mockedRun = generateMockRun('ember serve', function() {
          ranPassedInCommand = true;
          return RSVP.resolve(0);
        });
        mockery.registerMock('./run', mockedRun);

        let setupResult = setupTryEach.call(this, {
          config,
          commandArgs: ['ember', 'serve'],
          dependencyManagerAdapters: [new StubDependencyAdapter()]
        });
        let output = setupResult.output;
        let tryEachTask = setupResult.tryEachTask;

        return tryEachTask.run(config.scenarios, {}).then(function() {
          expect(output).to.include('Scenario first: SUCCESS');
          expect(ranPassedInCommand).to.equal(true, 'Should run the passed in command');
        }).catch(catchErrorLog);
      });

      it('uses command from config', function() {
        // With stubbed dependency manager, timing out is warning for accidentally not using the stub
        this.timeout(1200);

        var config = {
          command: 'ember test --test-port=2345',
          scenarios: [{
            name: 'first',
            dependencies: {
              ember: '1.13.0'
            }
          },{
            name: 'second',
            dependencies: {
              ember: '2.2.0'
            }
          },{
            name: 'different',
            command: 'npm run-script different',
            dependencies: {
              ember: '2.0.0'
            }
          }]
        };

        var ranDefaultCommandCount = 0;
        var ranScenarioCommandCount = 0;
        var mockedRun = generateMockRun([{
          command: 'ember test --test-port=2345',
          callback: function() {
            ranDefaultCommandCount++;
            return RSVP.resolve(0);
          }
        },{
          command: 'npm run-script different',
          callback: function() {
            ranScenarioCommandCount++;
            return RSVP.resolve(0);
          }
        }]);
        mockery.registerMock('./run', mockedRun);

        let setupResult = setupTryEach.call(this, {
          config,
          dependencyManagerAdapters: [new StubDependencyAdapter()]
        });
        let output = setupResult.output;
        let tryEachTask = setupResult.tryEachTask;

        return tryEachTask.run(config.scenarios, {}).then(function() {
          expect(output).to.include('Scenario first: SUCCESS');
          expect(output).to.include('Scenario second: SUCCESS');
          expect(output).to.include('Scenario different: SUCCESS');

          expect(ranDefaultCommandCount).to.equal(2, 'Should run the default command scenarios without their own commands specified');
          expect(ranScenarioCommandCount).to.equal(1, 'Should run the scenario command for scenario that specified it');
        }).catch(catchErrorLog);
      });

      it('allows passing options to the command run', function() {
        // With stubbed dependency manager, timing out is warning for accidentally not using the stub
        this.timeout(10000);

        var config = {
          scenarios: [{
            name: 'first',
            dependencies: {
              ember: '1.13.0'
            }
          }]
        };

        let setupResult = setupTryEach.call(this, {
          config: config,
          commandArgs: ['ember', 'help', '--json', 'true'],
          dependencyManagerAdapters: [new StubDependencyAdapter()]
        });
        let output = setupResult.output;
        let tryEachTask = setupResult.tryEachTask;

        return tryEachTask.run(config.scenarios, {}).then(function() {
          expect(output).to.include('Scenario first: SUCCESS', 'Passing scenario means options were passed along');
        }).catch(catchErrorLog);
      });
    });

    it('sets EMBER_TRY_CURRENT_SCENARIO', function() {
      // With stubbed dependency manager, timing out is warning for accidentally not using the stub
      this.timeout(1200);

      var config = {
        scenarios: [{
          name: 'first',
          dependencies: {
            ember: '1.13.0'
          }
        }]
      };

      var scenarios = [];
      var mockRunCommand = function() {
        var currentScenario = process.env.EMBER_TRY_CURRENT_SCENARIO;
        scenarios.push(currentScenario);
        return RSVP.resolve(true);
      };

      let setupResult = setupTryEach.call(this, {
        config,
        _runCommand: mockRunCommand,
        dependencyManagerAdapters: [new StubDependencyAdapter()]
      });
      let output = setupResult.output;
      let tryEachTask = setupResult.tryEachTask;

      writeJSONFile('bower.json', fixtureBower);
      return tryEachTask.run(config.scenarios, {}).then(function() {
        expect(scenarios).to.eql(['first']);
        var currentScenarioIsUndefined = process.env.EMBER_TRY_CURRENT_SCENARIO === undefined;
        expect(currentScenarioIsUndefined).to.equal(true);
      }).catch(catchErrorLog);
    });
  });

});
