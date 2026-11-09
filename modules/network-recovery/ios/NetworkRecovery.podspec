Pod::Spec.new do |s|
  s.name = 'NetworkRecovery'
  s.version = '1.0.0'
  s.summary = 'App-only connection recovery for Luche'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = { 'Luche' => 'peter.skovorodnikov@gmail.com' }
  s.homepage = 'https://github.com/la-luche/luchern'
  s.source = { :git => 'https://github.com/la-luche/luchern.git' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'Network'
end
