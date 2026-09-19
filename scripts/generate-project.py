#!/usr/bin/env python3
"""Regenerate the checked-in Xcode project using only Python's standard library."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
objects = {}
def uid(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def add(name, value):
    key = uid(name); objects[key] = value; return key

def serialize(value, indent=0):
    if isinstance(value, dict):
        return '{\n' + ''.join('\t'*(indent+1) + k + ' = ' + serialize(v, indent+1) + ';\n' for k,v in value.items()) + '\t'*indent + '}'
    if isinstance(value, list): return '(' + ', '.join(serialize(v, indent) for v in value) + (',' if value else '') + ')'
    return json.dumps(str(value))

files = {}
for path in sorted(root.glob('CapsuleScan/**/*.swift')):
    rel = str(path.relative_to(root))
    files[rel] = add(rel, {'isa':'PBXFileReference','lastKnownFileType':'sourcecode.swift','path':rel,'sourceTree':'<group>'})
for path in sorted(root.glob('CapsuleScanTests/*.swift')):
    rel = str(path.relative_to(root))
    files[rel] = add(rel, {'isa':'PBXFileReference','lastKnownFileType':'sourcecode.swift','path':rel,'sourceTree':'<group>'})
assets = add('assets', {'isa':'PBXFileReference','lastKnownFileType':'folder.assetcatalog','path':'CapsuleScan/Assets.xcassets','sourceTree':'<group>'})
info = add('info', {'isa':'PBXFileReference','lastKnownFileType':'text.plist.xml','path':'CapsuleScan/Info.plist','sourceTree':'<group>'})
bundled = []
for path in sorted(root.glob('CapsuleScan/Resources/*')):
    rel = str(path.relative_to(root))
    bundled.append(add(rel, {'isa':'PBXFileReference','lastKnownFileType':'file','path':rel,'sourceTree':'<group>'}))
app = add('app-product', {'isa':'PBXFileReference','explicitFileType':'wrapper.application','path':'CapsuleScan.app','sourceTree':'BUILT_PRODUCTS_DIR'})
tests = add('test-product', {'isa':'PBXFileReference','explicitFileType':'wrapper.cfbundle','path':'CapsuleScanTests.xctest','sourceTree':'BUILT_PRODUCTS_DIR'})
products = add('products', {'isa':'PBXGroup','children':[app,tests],'name':'Products','sourceTree':'<group>'})
appgroup = add('app-group', {'isa':'PBXGroup','children':[v for k,v in files.items() if k.startswith('CapsuleScan/')]+[assets,info]+bundled,'name':'CapsuleScan','sourceTree':'<group>'})
testgroup = add('test-group', {'isa':'PBXGroup','children':[v for k,v in files.items() if k.startswith('CapsuleScanTests/')],'name':'CapsuleScanTests','sourceTree':'<group>'})
main = add('main-group', {'isa':'PBXGroup','children':[appgroup,testgroup,products],'sourceTree':'<group>'})
def phase(name, isa, refs):
    builds = [add(name+ref, {'isa':'PBXBuildFile','fileRef':ref}) for ref in refs]
    return add(name, {'isa':isa,'buildActionMask':'2147483647','files':builds,'runOnlyForDeploymentPostprocessing':'0'})
appSources = phase('app-sources','PBXSourcesBuildPhase',[v for k,v in files.items() if k.startswith('CapsuleScan/')])
testSources = phase('test-sources','PBXSourcesBuildPhase',[v for k,v in files.items() if k.startswith('CapsuleScanTests/')])
resources = phase('resources','PBXResourcesBuildPhase',[assets]+bundled)
appFrameworks = phase('app-frameworks','PBXFrameworksBuildPhase',[])
testFrameworks = phase('test-frameworks','PBXFrameworksBuildPhase',[])
common = {'COPY_PHASE_STRIP':'NO','LM_SKIP_METADATA_EXTRACTION':'YES','CLANG_ENABLE_MODULES':'YES','CLANG_ENABLE_OBJC_ARC':'YES','GCC_C_LANGUAGE_STANDARD':'gnu17','CLANG_CXX_LANGUAGE_STANDARD':'gnu++20','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SDKROOT':'iphoneos','SWIFT_VERSION':'6.0','SWIFT_STRICT_CONCURRENCY':'complete','ENABLE_USER_SCRIPT_SANDBOXING':'YES','GCC_WARN_ABOUT_RETURN_TYPE':'YES_ERROR','GCC_WARN_UNINITIALIZED_AUTOS':'YES_AGGRESSIVE','CLANG_WARN_DOCUMENTATION_COMMENTS':'YES','CLANG_WARN_UNREACHABLE_CODE':'YES','SWIFT_TREAT_WARNINGS_AS_ERRORS':'YES'}
appSettings = {'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':'dev.gtfol.capsulescan','TARGETED_DEVICE_FAMILY':'1','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','SUPPORTS_MACCATALYST':'NO','SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD':'NO','SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD':'NO','CODE_SIGN_STYLE':'Automatic','INFOPLIST_FILE':'CapsuleScan/Info.plist','GENERATE_INFOPLIST_FILE':'NO','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','MARKETING_VERSION':'1.0','CURRENT_PROJECT_VERSION':'6','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks']}
testSettings = {'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':'dev.gtfol.capsulescan.tests','TARGETED_DEVICE_FAMILY':'1','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','CODE_SIGN_STYLE':'Automatic','GENERATE_INFOPLIST_FILE':'YES','TEST_HOST':'$(BUILT_PRODUCTS_DIR)/CapsuleScan.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/CapsuleScan','BUNDLE_LOADER':'$(TEST_HOST)','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks','@loader_path/Frameworks']}
def configs(name, settings):
    refs=[]
    for config in ['Debug','Release']:
        values=dict(settings)
        if name=='project':
            values.update({'DEBUG_INFORMATION_FORMAT':'dwarf' if config=='Debug' else 'dwarf-with-dsym','SWIFT_OPTIMIZATION_LEVEL':'-Onone' if config=='Debug' else '-O','ONLY_ACTIVE_ARCH':'YES' if config=='Debug' else 'NO','ENABLE_TESTABILITY':'YES' if config=='Debug' else 'NO'})
            if config=='Debug': values['SWIFT_ACTIVE_COMPILATION_CONDITIONS']='DEBUG $(inherited)'
            else: values['SWIFT_COMPILATION_MODE']='wholemodule'
        refs.append(add(name+config,{'isa':'XCBuildConfiguration','buildSettings':values,'name':config}))
    return add(name+'configs',{'isa':'XCConfigurationList','buildConfigurations':refs,'defaultConfigurationIsVisible':'0','defaultConfigurationName':'Release'})
projectConfigs = configs('project',common)
appConfigs = configs('app',appSettings)
testConfigs = configs('tests',testSettings)
appTarget = add('app-target',{'isa':'PBXNativeTarget','buildConfigurationList':appConfigs,'buildPhases':[appSources,appFrameworks,resources],'buildRules':[],'dependencies':[],'name':'CapsuleScan','productName':'CapsuleScan','productReference':app,'productType':'com.apple.product-type.application'})
proxy = add('test-proxy',{'isa':'PBXContainerItemProxy','containerPortal':uid('project'),'proxyType':'1','remoteGlobalIDString':appTarget,'remoteInfo':'CapsuleScan'})
dep = add('test-dependency',{'isa':'PBXTargetDependency','target':appTarget,'targetProxy':proxy})
testTarget = add('test-target',{'isa':'PBXNativeTarget','buildConfigurationList':testConfigs,'buildPhases':[testSources,testFrameworks],'buildRules':[],'dependencies':[dep],'name':'CapsuleScanTests','productName':'CapsuleScanTests','productReference':tests,'productType':'com.apple.product-type.bundle.unit-test'})
project = add('project',{'isa':'PBXProject','attributes':{'BuildIndependentTargetsInParallel':'YES','LastUpgradeCheck':'2660','TargetAttributes':{appTarget:{'CreatedOnToolsVersion':'26.6'},testTarget:{'CreatedOnToolsVersion':'26.6','TestTargetID':appTarget}}},'buildConfigurationList':projectConfigs,'compatibilityVersion':'Xcode 14.0','developmentRegion':'en','hasScannedForEncodings':'0','knownRegions':['en','Base'],'mainGroup':main,'productRefGroup':products,'projectDirPath':'','projectRoot':'','targets':[appTarget,testTarget]})
output = '// !$*UTF8*$!\n' + serialize({'archiveVersion':'1','classes':{},'objectVersion':'56','objects':objects,'rootObject':project}) + '\n'
(root/'CapsuleScan.xcodeproj/project.pbxproj').write_text(output)
def reference(identifier,name,product):
    return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{identifier}" BuildableName="{product}" BlueprintName="{name}" ReferencedContainer="container:CapsuleScan.xcodeproj"/>'
a=reference(appTarget,'CapsuleScan','CapsuleScan.app');t=reference(testTarget,'CapsuleScanTests','CapsuleScanTests.xctest')
scheme=f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2660" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{a}</BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO" parallelizable="NO">{t}</TestableReference></Testables></TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{a}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{a}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
'''
(root/'CapsuleScan.xcodeproj/xcshareddata/xcschemes/CapsuleScan.xcscheme').write_text(scheme)
