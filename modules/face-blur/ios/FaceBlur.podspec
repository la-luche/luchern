Pod::Spec.new do |s|
  s.name             = 'FaceBlur'
  s.version          = '1.0.0'
  s.summary          = 'On-device privacy blurring for Luche recordings'
  s.description      = 'A local Expo module that uses QuickPose to blur faces and backgrounds before upload.'
  s.license          = { :type => 'MIT' }
  s.author           = { 'Luche' => 'peter.skovorodnikov@gmail.com' }
  s.homepage         = 'https://github.com/la-luche/luchern'
  s.source           = { :git => 'https://github.com/la-luche/luchern.git' }
  s.platform         = :ios, '15.1'
  s.swift_version    = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'QuickPoseCore'

  s.source_files = '**/*.{h,m,mm,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
