import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';

import '../../data/support_repository.dart';

const maxAttachmentBytes = 10 * 1024 * 1024;

String mimeFor(String name) {
  final n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

/// PDF/JPEG/PNG from storage. Null if cancelled. Size is checked by the caller (and again by the API).
Future<PickedAttachment?> pickDocument() async {
  final files = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png']);
  if (files.isEmpty) return null;
  final f = files.first;
  return PickedAttachment(f.name, await f.readAsBytes(), mimeFor(f.name));
}

Future<PickedAttachment?> takePhoto() async {
  final x = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 85, maxWidth: 2400);
  if (x == null) return null;
  return PickedAttachment(x.name, await x.readAsBytes(), x.mimeType ?? mimeFor(x.name));
}
