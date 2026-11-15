import Speech
import AVFoundation
import UIKit

import Observation

@MainActor @Observable final class VoiceInput {
    var recording = false
    var issue: String?
    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let soundCaptureID = UUID()
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var token = UUID()
    @ObservationIgnored private var tapped = false
    @ObservationIgnored private var audioActive = false
    func start(_ update: @escaping (String) -> Void) async {
        stop()
        let id = token
        let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning:$0) } }
        guard id == token else { return }
        guard speech == .authorized else { issue = "Allow speech recognition in iPhone Settings to dictate a search."; return }
        let mic = await AVAudioApplication.requestRecordPermission()
        guard id == token else { return }
        guard mic, let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            issue = "Dictation is unavailable. Check microphone access or type instead."
            return
        }
        do {
            AppSounds.shared.beginCapture(soundCaptureID)
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode:.measurement)
            try audio.setActive(true)
            audioActive = true
            let request = SFSpeechAudioBufferRecognitionRequest()
            let node = engine.inputNode
            let format = node.outputFormat(forBus:0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain:"Microphone",code:1) }
            node.installTap(onBus:0,bufferSize:1024,format:format) { buffer,_ in request.append(buffer) }
            tapped = true
            try engine.start()
            recording = true
            task = recognizer.recognitionTask(with:request) { result,error in
                Task { @MainActor in
                    guard self.token == id else { return }
                    if let result { update(result.bestTranscription.formattedString) }
                    if error != nil || result?.isFinal == true { self.stop() }
                }
            }
        } catch { stop(); issue = "Couldn’t start the microphone. You can still type." }
    }
    func stop() {
        AppSounds.shared.endCapture(soundCaptureID)
        guard recording || tapped || task != nil || audioActive else { return }
        token = UUID()
        if tapped { engine.inputNode.removeTap(onBus:0); tapped = false }
        engine.stop()
        task?.cancel()
        task = nil
        recording = false
        try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)
        audioActive = false
    }
}


// MARK: - Small, original interface sounds

/// PCM is generated locally: no downloaded audio, network dependency, or additional bundle assets.
enum OracleSound: CaseIterable, Hashable {
    case tap, hello, success, miss

    var notes: [(start: Double, frequency: Double, duration: Double)] {
        switch self {
        case .tap: [(0, 740, 0.055)]
        case .hello: [(0, 659.25, 0.14), (0.08, 880, 0.18)]
        case .success: [(0, 523.25, 0.15), (0.08, 659.25, 0.15), (0.16, 783.99, 0.22)]
        case .miss: [(0, 392, 0.12), (0.09, 329.63, 0.16)]
        }
    }

    var wav: Data {
        let rate = 22050
        let duration = notes.map { $0.start + $0.duration }.max() ?? 0
        let count = Int(ceil(duration * Double(rate)))
        var pcm = Data(capacity: count * 2)
        for index in 0..<count {
            let time = Double(index) / Double(rate)
            var sample = 0.0
            for note in notes {
                let t = time - note.start
                guard t >= 0, t < note.duration else { continue }
                let attack = min(1, t / 0.006)
                let tail = min(1, (note.duration - t) / 0.025)
                let decay = exp(-t * 11)
                sample += (sin(2 * .pi * note.frequency * t) + 0.12 * sin(4 * .pi * note.frequency * t)) * attack * tail * decay * 0.22
            }
            var value = Int16(max(-1, min(1, sample)) * Double(Int16.max)).littleEndian
            withUnsafeBytes(of: &value) { pcm.append(contentsOf: $0) }
        }
        var result = Data("RIFF".utf8)
        func word<T: FixedWidthInteger>(_ value: T) {
            var value = value.littleEndian
            withUnsafeBytes(of: &value) { result.append(contentsOf: $0) }
        }
        word(UInt32(36 + pcm.count)); result.append(Data("WAVEfmt ".utf8))
        word(UInt32(16)); word(UInt16(1)); word(UInt16(1)); word(UInt32(rate))
        word(UInt32(rate * 2)); word(UInt16(2)); word(UInt16(16))
        result.append(Data("data".utf8)); word(UInt32(pcm.count)); result.append(pcm)
        return result
    }
}

@MainActor final class AppSounds {
    static let shared = AppSounds()
    private var player: AVAudioPlayer?
    private var captureOwners = Set<UUID>()
    private var lastPlayed = Date.distantPast
    private var cache: [OracleSound: Data] = [:]

    var enabled: Bool {
        UserDefaults.standard.object(forKey: "oracle.sounds.enabled") as? Bool ?? true
    }

    func play(_ sound: OracleSound) {
        guard enabled, captureOwners.isEmpty, UIApplication.shared.applicationState == .active,
              Date().timeIntervalSince(lastPlayed) > 0.07 else { return }
        do {
            let audio = AVAudioSession.sharedInstance()
            // Ambient respects the Silent switch and mixes with music from other apps.
            if audio.category != .ambient { try audio.setCategory(.ambient, mode: .default) }
            try audio.setActive(true)
            let data = cache[sound] ?? sound.wav
            cache[sound] = data
            let next = try AVAudioPlayer(data: data)
            next.volume = sound == .tap ? 0.35 : 0.5
            next.prepareToPlay()
            player?.stop(); player = next
            if next.play() { lastPlayed = .now }
        } catch {
            // Decorative audio must never block the action that triggered it.
        }
    }

    func stop() { player?.stop(); player = nil }
    func beginCapture(_ owner: UUID) { captureOwners.insert(owner); stop() }
    func endCapture(_ owner: UUID) { captureOwners.remove(owner) }
}
