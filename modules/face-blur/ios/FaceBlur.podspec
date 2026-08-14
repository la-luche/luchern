Pod::Spec.new do |s|
  s.name             = 'FaceBlur'
  s.version          = '1.0.0'
  s.summary          = 'On-device privacy blurring for Luche recordings'
  s.description      = 'A local Expo module that uses RTMDet and RTMPose to redact faces and backgrounds before upload.'
  s.license          = { :type => 'MIT' }
  s.author           = { 'Luche' => 'peter.skovorodnikov@gmail.com' }
  s.homepage         = 'https://github.com/la-luche/luchern'
  s.source           = { :git => 'https://github.com/la-luche/luchern.git' }
  s.platform         = :ios, '15.1'
  s.swift_version    = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'onnxruntime-objc', '1.28.0'

  s.source_files = '*.swift'
  s.resources = 'Resources/*'
  s.preserve_paths = 'Resources/*'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
