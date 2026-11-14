import AVFoundation
import Foundation
import Speech

/// On-device push-to-talk. Audio stays in memory and is never written out.
final class ListenSession {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    var latest = ""
    var emitted = false

    func emit(_ payload: [String: String]) -> Never {
        if !emitted {
            emitted = true
            let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([0x0A]))
        }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        task?.cancel()
        exit(0)
    }

    func finish() {
        let text = latest.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            emit(["error": "silence"])
        } else {
            emit(["text": String(text.prefix(400))])
        }
    }
}

let session = ListenSession()
// MIKO's launcher reads this first line to know which pid to signal.
FileHandle.standardOutput.write(Data("{\"pid\":\(getpid())}\n".utf8))
/// Hold-to-talk (Caps Lock + A): no 8 s auto-finish, MIKO sends SIGUSR1 on release.
let holdMode = CommandLine.arguments.contains("--hold")
signal(SIGTERM, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
term.setEventHandler {
    session.emit(["error": "cancelled"])
}
term.resume()

func stopAndFinish() {
    session.request.endAudio()
    session.engine.stop()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
        session.finish()
    }
}

// MIKO launches this helper through LaunchServices, so "stop" arrives as SIGUSR1.
signal(SIGUSR1, SIG_IGN)
let usr1 = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
usr1.setEventHandler { stopAndFinish() }
usr1.resume()

// A "stop" line on stdin still works when the helper is run by hand.
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        if line == "stop" {
            DispatchQueue.main.async { stopAndFinish() }
        }
    }
}

guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
    session.emit(["error": "unavailable"])
}

func note(_ text: String) {
    FileHandle.standardError.write(Data((text + "\n").utf8))
}

/// Ask for the microphone explicitly. Without this, AVAudioEngine can start and deliver silence.
func withMicrophone(_ next: @escaping () -> Void) {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    note("mic status \(status.rawValue)")
    switch status {
    case .authorized:
        next()
    case .notDetermined:
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            note("mic granted \(granted)")
            DispatchQueue.main.async {
                if granted { next() } else { session.emit(["error": "denied"]) }
            }
        }
    default:
        session.emit(["error": "denied"])
    }
}

SFSpeechRecognizer.requestAuthorization { status in
    note("speech status \(status.rawValue)")
    if status != .authorized {
        session.emit(["error": "denied"])
    }
    DispatchQueue.main.async { withMicrophone(startRecognition) }
}

func startRecognition() {
    let recognizer = SFSpeechRecognizer()!
    session.request.requiresOnDeviceRecognition = true
    session.request.shouldReportPartialResults = true
    let input = session.engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
        session.emit(["error": "unavailable"])
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        session.request.append(buffer)
    }
    session.engine.prepare()
    do {
        try session.engine.start()
    } catch {
        session.emit(["error": "denied"])
    }
    session.task = recognizer.recognitionTask(with: session.request) { result, error in
        if let result {
            session.latest = result.bestTranscription.formattedString
            if result.isFinal {
                session.finish()
            }
        }
        if error != nil && !session.emitted && session.latest.isEmpty {
            session.emit(["error": "silence"])
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + (holdMode ? 55 : 8)) {
        session.request.endAudio()
        session.engine.stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            session.finish()
        }
    }
}

// Exit if MIKO goes away mid-recording, releasing the microphone.
if let index = CommandLine.arguments.firstIndex(of: "--parent"),
   index + 1 < CommandLine.arguments.count,
   let parent = Int32(CommandLine.arguments[index + 1]), parent > 1 {
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
        if kill(parent, 0) != 0 && errno == ESRCH { exit(0) }
    }
}

dispatchMain()
